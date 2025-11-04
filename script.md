# ACWAverse Demo Script

TAB 1

1- Introduction  
Hi, I am Mehmet Oguz Yardimci a Computer Science PhD Student at Virginia Tech's A3 Lab.

In this video I will provide a concise tour of ACWAverse, a browser-based hydraulic simulation environment for modeling and evaluating cyber-physical water systems.

In the next couple of minutes, I will show how you can use ACWAverse to: design complex water distribution networks, configure and run hydraulic simulations, analyse cyber-physical behaviour under scripted controls, and stage attack scenarios to support your research.

2- System Management  
ACWAverse launches into the System Management panel.

The sample selector contains several readly-made networks, including Some basic examples, a real life system from Texas muleshoe and the ACWA lab's line, bus, and star testbed topologies.

The green “Load System from File” button imports user-supplied JSON exports of previously saved systems, which is useful when exchanging layouts with collaborators.

Therefore you can either begin with a benchmark network or resume prior work captured on disk.

or with the “Create New System” button you can initializes a blank project containing an empty network, and build a system from scratch.

I will load one of these samples to establish a baseline.

3- Build Your Network  
Loading a system reveals the main simulator interface and defaults to the Build Your Network tab.

The left column is the component palette.

Each button adds a source, pump, valve, junction, tank, or sink.

Tank insertion opens a geometry selector so we can declare cylindrical, rectangular, or spherical designs, which later determine cross-sectional area computations.

The legend below the palette indicates the color assigned to each component class.

Under the Network Management section there are: a zoom slider, layout direction toggle, and buttons for Balanced, Topological, or Compact layouts.

These options allow the user to visualize topology in different graph views.

Connections between components appear as arrows; the “Connectivity Matrix” dialog provides a grid interface for toggling directed edges explicitly.

Selecting a node opens a modal to edit its identifier or, for hydraulic elements, revise parameters such as tank dimensions or pump capacity.

The “Save System” action exports the current configuration to JSON, while “Save Network PNG” captures a static diagram for documentation. At this stage the network specification, including geometry and connectivity, is complete.

4- Simulation Settings  
The Simulation Settings tab defines the operating scenario.

At the top, the simulation duration in seconds and the ambient temperature, which influences thermodynamic calculations in the engine, are given.

The Initial State pane is generated dynamically per component.

Tanks expose water level, temperature, pH, dissolved oxygen, BODn, nitrate, and CO₂ fields; pumps list the initial power set point and maximum flow rate; valves provide an initial state toggle and nominal flow rate. Sources and sinks include head values, while junctions have no adjustable parameters.

These entries are written back to the network model when “Start Simulation” is pressed.

Before starting, you should review the values to ensure they reproduce the intended experimental conditions.

5- Analysis & Visualization  
Once the engine completes the run, the Analysis & Visualization tab activates.

Here I select a component to visualize its time series data.

The charts display quantities such as fluid levels, temperatures, and chemical concentrations as calculated by the ACWA engine, with annotation support for marking significant events.

If further processing is required, the “Export Results (CSV)” button produces a comprehensive file containing the simulation outputs across all time steps.

This workflow supports quantitative evaluation without leaving the browser, yet remains interoperable with external research pipelines.

6- Timed Control Actions  
Moving to operational adjustments, the Timed Control Actions tab schedules deterministic interventions.

For each entry I specify the activation time, the target component, and the action.

Such as “Set Pump Power,” or “Set Valve State”

Parameter fields appear dynamically to capture the desired power percentage or flow rate.

Actions are listed chronologically in the table below, and each row provides edit and delete controls.

These scheduled interventions are essential for replicating operator actions or scripted experiments where the network must change state over time.

7- Conditional Actions  
Conditional Actions extend the control logic by introducing state-dependent rules.

Using the IF/THEN layout, you choose a source component, select a monitored variable, pick a comparison operator, and set a threshold.

The target section then assigns an action to a pump or valve, such as setting a specific power, reducing or increasing power, or closing a valve.

After saving, the rule appears in the summary table with a remove option.

This mechanism enables automated safeguards—for example, throttling a pump when a downstream tank level falls below the permitted range—supporting studies of resilience and supervisory control.

8- Cyber-Physical Attack Scenarios  
The final module allows modeling Cyber-Physical Attack scenarios.

Currently ACWAverse supports 4 different types of attack.

Chemical Dosing; injects an acid or base at a specified time to perturb pH.

Chemical Interference manipulates constituents such as BODn, dissolved oxygen, nitrate, or CO₂ by a defined amount.

Physical Damage introduces failures like tank leaks, pump outages, or valves stuck in place.

Data Poisoning forges sensor readings over a start time and duration.

these false values can trigger condutional actions and allows attacks to manupilate the system in unitended ways.

Every scenario requires a timestamp and a target component.

The import and export buttons at the top exchange JSON bundles that include control actions, conditional actions, and attack definitions so that combined experiments remain reproducible between experiments and across team members.

9- Summarize  
To summarise, ACWAverse supports the life cycle of cyber-physical water system experiments: assembling networks, configuring environmental and initial conditions, running the simulation engine, analysing outputs, embedding operational policies, and challenging systems with adversarial events.

The interface keeps these tasks accessible in the browser while preserving structured data exports for external analysis.

10- A3 Lab  
ACWAverse is an open-source and easily extendable project. Feel free to contribute to or fork the project.

For academical uses please use the citation information available in the description of this video and the github page of ACVAverse

TAB 2

ACWAverse is developed in the AI Assurance and Applications (A3) Lab at Virginia Tech.
A3 is focused on trustworthy AI—assurance, verification/validation, robustness, and safety—for cyber-physical and data-driven systems in water, agriculture, and critical infrastructure.

TAB 3

The ACWA Lab is one of A3's physical testbeds: a reconfigurable water-distribution platform with line, bus, and star networks; recirculating loops; programmable pumps and valves; inline sensors such as flow, pressure, level, temperature, pH, dissolved oxygen, and conductivity; and SCADA-like control and telemetry.

Algorithms, control policies, and attack scenarios in ACWAverse are exercised on the ACWA Lab to validate performance and realism.

Lab data are used to calibrate models and to build reproducible evaluation scenarios in the simulator.

Please reach out to us at A3 Lab discord channel, if additional clarification or collaboration is of interest.

Thank you for watching

python3 -m http.server 8000 --directory src
