# ACWAverse: An Interactive Cyber-Physical Water System Simulator for Security and Attack Analysis

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-Live-brightgreen)](https://AI-VTRC.github.io/ACWAverse/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A simulator for water systems as cyber-physical systems. You draw a plant
(tanks, pipes, pumps, valves), put a control system on top of it (sensors and
control actions), attack either one, and watch what the water does. Every run can
be exported as a labelled table for training and testing attack detectors.

**Developed at:** [A3 Lab](https://ai.bse.vt.edu) (AI Assurance and Applications) and [ACWA Lab](https://ai.bse.vt.edu/ACWA_Lab.html) (AI & Cyber for Water & Ag)  
**Institution:** Virginia Polytechnic Institute and State University (Virginia Tech)

It runs entirely in the browser. There is no server and no runtime
dependency. The application is online at
https://AI-VTRC.github.io/ACWAverse/. To run it from source:

```
npm install
npm test          # compile the engine and run the 105 tests
npm run build     # build the web application into docs/
npm run serve     # http://localhost:8080
```

`docs/acwaverse.html` is the whole application in one file; it can be opened
straight from disk.

## The model

A water system is described the way hydraulic engineers draw it.

**Nodes** are places where water is: a *junction* (a pipe joint, optionally
with a consumer demand), a *tank* (storage with a free surface) and a
*reservoir* (a source or sink of fixed head).

**Links** join two nodes and carry flow: a *pipe*, a *pump* and a *valve*.
Every link has a first node (`from`) and a second (`to`).

- For a pipe this only fixes the sign of its flow.
- For a pump it is physical. `from` is the suction side and `to` is the
  discharge side. The pump adds head in that direction only, and its check
  valve stops water coming back when it is off. On the diagram the arrow in
  the pump symbol points from suction to discharge, the inspector says "draws
  from A, delivers to B", and one button turns the pump around.
- For a valve `from` is the inlet.

The **control system** is a separate layer, named as in the ACWAverse paper.
A *sensor* measures one quantity on one element, with optional noise.
*Control actions* command an actuator (a pump speed or a valve setting):

| Kind | `type` | What it does |
|---|---|---|
| Timed control action | `timed` | Commands a setting at given times, optionally repeating. |
| Conditional action | `conditional` | While a sensor reading meets a condition, commands a setting. |
| On/off control | `onoff` | A pair of conditional actions with a dead band: on below one level, off above another. |
| PID loop | `pid` | Holds a reading at a setpoint by adjusting the actuator. |

Control actions see only what sensors report, never the true state. The last
two kinds are additions; the paper describes the first two.

**Cyber-physical attacks** fall into the paper's three families and are placed
on what they act on:

| Family | Attack (`type`) | Acts on |
|---|---|---|
| Data poisoning | data poisoning (`data_poisoning`): constant, offset, scale, freeze, drift, noise, replay | a sensor |
| Data poisoning | command injection (`command_injection`) | an actuator |
| Data poisoning | control action tampering (`controller_tamper`): disabled, or settings changed | a control action |
| Physical damage | pump failure (`pump_failure`) | a pump |
| Physical damage | valve stuck (`valve_stuck`) | a valve |
| Physical damage | leak (`leak`): an orifice of a given size | a junction or tank |
| Physical damage | pipe blockage (`pipe_blockage`) | a pipe |
| Chemical interference | chemical interference (`chemical_interference`): chlorine, dechlorinating agent, oxygen scavenger, acid, base, ammonia, organic matter, nitrate, tracer | a junction or tank |

Command injection and control action tampering are additions. They falsify
data inside the control system, so they are counted with data poisoning.

Data poisoning changes what the conditional actions do and what an operator
would see, while the plant carries on according to the physics. Results keep
both: the reported value and the true one. Every attack has a start time and
a duration, and is active from its start up to, but not including, its end.

## What is computed

**Hydraulics.** Heads and flows come from the Global Gradient Algorithm, the
method used by EPANET, with tank storage solved implicitly so that directly
connected tanks stay stable at any time step.

- Pipes: Hazen-Williams or Darcy-Weisbach (Swamee-Jain friction factor), minor
  losses, optional check valve.
- Pumps: centrifugal head curve `h = a0·ω² + a1·ω·q + a2·q²` with the affinity
  laws for speed, shaft power and efficiency around a best-efficiency point,
  ramp time, and a net-positive-suction-head check that flags cavitation.
- Valves: gate, globe, butterfly, ball and linear characteristics as a loss
  coefficient against opening, a stroke time, and a flow-limiting mode.
- Tanks: cylinder, box or sphere, with overflow or a float valve when full.
- Demands are pressure-driven (Wagner): consumers get less when pressure is
  short, and nothing below the minimum pressure.
- Leaks follow the orifice law; a blockage is a sudden contraction and
  expansion.

**Water quality.** Plug flow along pipes (Lagrangian segments), complete
mixing at junctions and in tanks. Tracked: temperature, free chlorine (bulk and
wall decay), alkalinity and inorganic carbon with pH from carbonate
equilibrium, dissolved oxygen, biochemical oxygen demand, ammonia and nitrate
(nitrification), a conservative tracer, and water age. Tanks exchange gases
and heat with the air.

**Checks.** `npm test` runs 105 tests. Six reference networks are compared
with EPANET 2.2 (through WNTR): flows agree within 0.2 %, heads within 0.1 %,
tank levels within 0.4 % and chlorine within 1.5 %. `tools/epanet_reference.py`
regenerates the reference values. Other tests check closed-form results
(Torricelli drain, pump operating points, affinity laws, mixing, mass
balance), every control action and attack type, the labelling of rows, and that
all seven example scenarios validate, run and balance.

Each run reports a water balance (supplied, delivered, leaked, spilled,
stored). The error is the volume the books fail to close by; in the examples
it is below a millionth of the volume moved.

## Results and datasets

A run produces a table with one row per report step. Columns are either the
sensor readings (what the control system sees, attacks included) or
everything, including the true state of every element. The last three columns
label each row: `attack` (0 or 1), `attack_class` (`data_poisoning`, `physical_damage`, `chemical_interference`)
and `attack_ids`. Values are SI: m, m³/s, m³, s, mg/L, kW.

The dataset generator runs a scenario many times, with and without its
attacks. Each run starts from slightly different tank levels and demands, and
each attack moves in time and changes in strength. The result is one CSV with
a `run` column, reproducible from its seed.

From code:

```js
import { simulate, generateDataset, toCSV } from './build/engine/index.js';

const results = simulate(scenario);
results.series['TOWER.level'];     // true value, one per row
results.series['LT1.reading'];     // what the sensor reported
results.labels.any;                // 1 where an attack is in progress

const dataset = generateDataset(scenario, { attackRuns: 20, normalRuns: 5, seed: 7 });
const csv = toCSV(dataset);
```

## Scenario files

A scenario is one JSON file (`"format": "acwaverse/2"`):

```json
{
  "format": "acwaverse/2",
  "name": "Pump, tower and town",
  "nodes": [
    { "id": "WELL", "type": "reservoir", "head": 8 },
    { "id": "J1", "type": "junction", "elevation": 0 },
    { "id": "TOWER", "type": "tank", "elevation": 35, "diameter": 10, "height": 8, "level": 4.5 },
    { "id": "TOWN", "type": "junction", "elevation": 5, "demand": 0.02 }
  ],
  "links": [
    { "id": "PU1", "type": "pump", "from": "WELL", "to": "J1", "shutoffHead": 60, "maxFlow": 0.05 },
    { "id": "P1", "type": "pipe", "from": "J1", "to": "TOWER", "length": 1000, "diameter": 0.25 },
    { "id": "P2", "type": "pipe", "from": "TOWER", "to": "TOWN", "length": 600, "diameter": 0.25 }
  ],
  "sensors": [{ "id": "LT1", "element": "TOWER", "quantity": "level", "noise": 0.01 }],
  "controllers": [{ "id": "C1", "type": "onoff", "sensor": "LT1", "actuator": "PU1", "action": "fill", "low": 3, "high": 6.5 }],
  "attacks": [{ "id": "A1", "type": "data_poisoning", "sensor": "LT1", "mode": "constant", "value": 3, "start": 14400, "duration": 7200 }],
  "simulation": { "duration": 86400, "timeStep": 30, "reportStep": 300 }
}
```

Every field, with its unit and default, is documented in
`engine/src/scenario.ts`. `validateScenario` reports problems in plain words
before anything runs.

## Examples

| File | What it shows |
|---|---|
| `muleshoe.json` | A small-town groundwater system: wells, two ground tanks, three boosters, a tower and a town. A data poisoning attack makes the tower level read low and the tower overflows, as in the January 2024 incident in Muleshoe, Texas. Dimensions are representative, not surveyed. |
| `pumped-tower.json` | The smallest complete supply: one pump, one tower, one town. |
| `four-tank-timed.json` | Four tanks in a ring under timed control actions. No attacks. |
| `four-tank-conditional.json` | The same ring under conditional actions, with four attacks. |
| `acwa-line.json`, `acwa-bus.json`, `acwa-star.json` | The ACWA laboratory testbed in its three layouts, each with data poisoning, physical damage and chemical interference. |

## Architecture

The four layers of the paper, and where each lives:

| Layer | Where | What |
|---|---|---|
| Front-end interface | `app/ui` | State, tools, inspector, and the control, attack, run and data panels. |
| Simulation engine | `engine/src` | TypeScript, no dependencies. Hydraulic simulation module (`network`, `elements`, `solver`), water quality module (`quality`), cyber-attack simulation module (`control`, `attacks`), and `scenario`, `simulation`, `dataset`. |
| Visualization engine | `app/viz` | The live diagram and the charts, drawn in SVG. |
| Data management | `app/data` | Scenario files, examples, editing operations, table and dataset export. |

## Limits

- Hydraulics are quasi-steady: there is no water hammer or other pressure
  transient.
- Pipes run full; there is no open-channel or partly full flow.
- A closed valve, a stopped pump and a seated check valve are modelled as a
  very large resistance, so a few millilitres per second can pass under a high
  head.
- Tanks are completely mixed.
- Reaction rates are first-order with a temperature correction; they are
  defaults to be calibrated, not measurements of any particular water.
- The control system is idealised: there is no network delay, packet loss or
  protocol model. Attacks act on values, not on packets.

## Deployment

GitHub Pages serves the `docs/` folder of the `main` branch. `npm run build`
writes the application into that folder, so a change reaches the site when the
rebuilt `docs/` is committed with it and lands on `main`. The empty
`docs/.nojekyll` file tells Pages to publish the files as they are.

## Citation

If you use ACWAverse in your research, please cite:

```bibtex
@article{yardimci2025acwaverse,
  title={ACWAverse: An Interactive Cyber-Physical Water System Simulator for Security and Attack Analysis},
  author={Yardimci, Mehmet Oguz and Batarseh, Feras A.},
  journal={[TBD]},
  year={2025},
  institution={Virginia Tech}
}
```

## Related Work

This work builds upon and extends the original ACWA project:
- **Original ACWA**: Physical testbed with 2-tank digital twin simulator ([ACWA Lab](https://ai.bse.vt.edu/ACWA_Lab.html))
- **ACWAverse**: Next-generation cyber-physical security research platform with unlimited scalability and integrated cyber-attack simulation

For more information about the ACWA physical testbed and related research, visit:
- [ACWA Data and Paper](https://ai.bse.vt.edu/ACWA_Lab.html)

## Research Labs

**A3 Lab (AI Assurance and Applications)**  
[A3 Lab Homepage](https://ai.bse.vt.edu)  
Virginia Tech Research Center (VTRC) 3rd floor  
900 N Glebe Rd, Arlington, VA 22203

**ACWA Lab (AI & Cyber for Water & Ag)**  
[ACWA Lab Homepage](https://ai.bse.vt.edu/ACWA_Lab.html)  
1230 Washington St SW, Blacksburg, VA 24061

## Authors

- **Mehmet Oguz Yardimci** - Department of Computer Science, Virginia Tech  
  - Email: oguzy@vt.edu
  - LinkedIn: [Mehmet Oguz Yardimci](https://www.linkedin.com/in/oguzyardimci/)

- **Feras A. Batarseh** - Department of Biological Systems Engineering, Virginia Tech  
  - Email: batarseh@vt.edu

## Acknowledgments

This work leverages the facilities of the ACWA Laboratory at Virginia Tech, including its instrumented physical testbed, PLC infrastructure, and curated datasets, which informed ACWAverse's requirements and provided ground truth for validation.

## Contact

For questions, collaborations, or contributions, please contact:
- **Mehmet Oguz Yardimci**: oguzy@vt.edu
- **Feras A. Batarseh**: batarseh@vt.edu

Visit our labs:
- [A3 Lab](https://ai.bse.vt.edu)
- [ACWA Lab](https://ai.bse.vt.edu/ACWA_Lab.html)
