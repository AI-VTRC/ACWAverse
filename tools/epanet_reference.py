#!/usr/bin/env python3
"""Reference results from EPANET 2.2 for the validation suite.

Reads the scenarios in tests/epanet/cases.json, builds the equivalent EPANET
model of each with WNTR, solves it with the EPANET toolkit and writes what
EPANET computes to tests/epanet/reference.json. The test suite runs the
ACWAverse engine on the same scenarios and compares.

    pip install wntr
    python tools/epanet_reference.py
"""
import json
import os
import tempfile

import wntr

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CASES = os.path.join(ROOT, 'tests', 'epanet', 'cases.json')
OUT = os.path.join(ROOT, 'tests', 'epanet', 'reference.json')


def build(case):
    scenario = case['scenario']
    sim = scenario['simulation']
    pipes = [link for link in scenario['links'] if link['type'] == 'pipe']
    darcy = any(pipe.get('friction') == 'darcy-weisbach' for pipe in pipes)

    wn = wntr.network.WaterNetworkModel()
    wn.options.hydraulic.headloss = 'D-W' if darcy else 'H-W'
    wn.options.hydraulic.accuracy = 1e-6
    wn.options.hydraulic.trials = 200
    wn.options.time.duration = int(sim['duration'])
    wn.options.time.hydraulic_timestep = int(sim['timeStep'])
    wn.options.time.report_timestep = int(sim.get('reportStep', sim['timeStep']))
    wn.options.time.quality_timestep = min(60, int(sim['timeStep']))

    junctions = [node for node in scenario['nodes'] if node['type'] == 'junction']
    if case.get('pda'):
        wn.options.hydraulic.demand_model = 'PDA'
        wn.options.hydraulic.minimum_pressure = junctions[0].get('minPressure', 0.0)
        wn.options.hydraulic.required_pressure = junctions[0].get('requiredPressure', 10.0)

    decay = scenario.get('chemistry', {}).get('chlorineBulkDecay')
    if decay is not None:
        wn.options.quality.parameter = 'CHEMICAL'
        wn.options.reaction.bulk_coeff = -decay / 86400.0
        wn.options.reaction.wall_coeff = 0.0

    for node in scenario['nodes']:
        nid = node['id']
        chlorine = node.get('quality', {}).get('chlorine', 0.0)
        if node['type'] == 'reservoir':
            wn.add_reservoir(nid, base_head=node['head'])
        elif node['type'] == 'tank':
            wn.add_tank(nid, elevation=node.get('elevation', 0.0), init_level=node['level'], min_level=0.0,
                        max_level=node['height'], diameter=node['diameter'], min_vol=0.0)
        else:
            pattern = None
            if node.get('pattern'):
                pattern = nid + '_pattern'
                wn.options.time.pattern_timestep = int(node.get('patternStep', 3600))
                wn.add_pattern(pattern, node['pattern'])
            wn.add_junction(nid, base_demand=node.get('demand', 0.0), demand_pattern=pattern,
                            elevation=node.get('elevation', 0.0))
        wn.get_node(nid).initial_quality = chlorine

    for link in scenario['links']:
        lid, a, b = link['id'], link['from'], link['to']
        if link['type'] == 'pipe':
            roughness = link.get('roughness', 0.26 if darcy else 130)
            if darcy:
                roughness = roughness / 1000.0  # WNTR takes metres
            wn.add_pipe(lid, a, b, length=link['length'], diameter=link['diameter'], roughness=roughness,
                        minor_loss=link.get('minorLoss', 0.0), check_valve=link.get('checkValve', False))
        elif link['type'] == 'pump':
            h0, qmax = link['shutoffHead'], link['maxFlow']
            points = [(q, h0 * (1 - (q / qmax) ** 2)) for q in (0.0, 0.5 * qmax, 0.9 * qmax)]
            wn.add_curve(lid + '_curve', 'HEAD', points)
            wn.add_pump(lid, a, b, pump_type='HEAD', pump_parameter=lid + '_curve', speed=link.get('speed', 1.0))
        else:
            # A valve at a fixed opening is a throttle valve with a known loss coefficient.
            assert link.get('kind') == 'linear', 'only linear valves are translated'
            k = link['fullOpenK'] / link.get('setting', 1.0) ** 2
            wn.add_valve(lid, a, b, diameter=link['diameter'], valve_type='TCV', minor_loss=0.0, initial_setting=k)
    return wn


def main():
    with open(CASES) as handle:
        cases = json.load(handle)
    output = []
    for case in cases:
        wn = build(case)
        with tempfile.TemporaryDirectory() as scratch:
            results = wntr.sim.EpanetSimulator(wn).run_sim(version=2.2, file_prefix=os.path.join(scratch, 'case'))
        compare = case['compare']
        reference = dict(name=case['name'], time=[int(t) for t in results.node['head'].index],
                         flows={}, heads={}, levels={}, chlorine={})
        for link in compare.get('flows', []):
            reference['flows'][link] = [float(v) for v in results.link['flowrate'][link]]
        for node in compare.get('heads', []):
            reference['heads'][node] = [float(v) for v in results.node['head'][node]]
        for node in compare.get('levels', []):
            reference['levels'][node] = [float(v) for v in results.node['pressure'][node]]
        for node in compare.get('chlorine', []):
            reference['chlorine'][node] = [float(v) for v in results.node['quality'][node]]
        output.append(reference)
        print(f"{case['name']}: {len(reference['time'])} report times")
    with open(OUT, 'w') as handle:
        json.dump(output, handle, indent=1)
        handle.write('\n')


if __name__ == '__main__':
    main()
