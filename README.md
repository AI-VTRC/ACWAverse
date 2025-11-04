# ACWAverse: An Interactive Cyber-Physical Water System Simulator for Security and Attack Analysis

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-Live-brightgreen)](https://AI-VTRC.github.io/ACWAverse/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A comprehensive web-based cyber-physical water system simulator designed for cybersecurity research, attack analysis, and intelligent system development. ACWAverse integrates advanced hydraulic modeling, water quality simulation, and sophisticated cyber-attack scenarios to create a powerful platform for cyber-physical security analysis.

**Developed at:** [A3 Lab](https://ai.bse.vt.edu) (AI Assurance and Applications) and [ACWA Lab](https://ai.bse.vt.edu/ACWA_Lab.html) (AI & Cyber for Water & Ag)  
**Institution:** Virginia Polytechnic Institute and State University (Virginia Tech)

---

## Overview

Water Supply Systems (WSS) are cornerstones of modern society, yet they face unprecedented challenges in the 21st century, including escalating demand, aging infrastructure, and sophisticated cyber threats. High-profile incidents such as the 2021 Oldsmar, Florida water treatment cyberattack and the 2024 Muleshoe, Texas water system compromise underscore the real-world risks of data poisoning and unauthorized control in water utilities.

ACWAverse addresses these critical challenges by providing a comprehensive simulation environment that concurrently models physical water distribution (hydraulics, quality) and sophisticated cyber-attack scenarios, creating a powerful tool for cybersecurity research and intelligent system development.

### Key Features

- **Modular 4-Layer Architecture**: Front-End Interface, Simulation Engine, Visualization Engine, and Data Management layers supporting unlimited network complexities
- **Advanced Cyber-Attack Simulation**: Integrated cyber-attack simulation with duration-based effects, real-time data poisoning, chemical interference, and physical damage scenarios
- **Comprehensive Hydraulic & Water Quality Modeling**: Advanced fluid dynamics, pump curves, valve logic, pH, DO, BOD, nitrate transport, and temperature modeling
- **Real-Time Web-Based Interface**: Runs entirely in modern browsers, no installation required
- **Digital Twin Functionality**: Enables real-time monitoring, predictive maintenance, and cyber-resilience assessment
- **Dataset Generation for ML**: Extensive capabilities for generating synthetic datasets for machine learning research in cyber-physical security
- **Interactive Visualization**: Multiple layout algorithms (topological, balanced, compact) with real-time attack visualization

---

## System Architecture

ACWAverse employs a modular, modern web-based architecture consisting of:

1. **Front-End Interface Layer**: Modern responsive web interface with real-time network visualization, interactive component management, and dynamic form controls
2. **Simulation Engine**: Three integrated modules:
   - **Hydraulic Simulation Module**: Advanced fluid dynamics calculations using graph-based topology management
   - **Water Quality Module**: Comprehensive modeling of pH, DO, BOD, nitrate transport, disinfectant decay, and temperature
   - **Cyber-Attack Simulation Module**: Data poisoning, chemical interference, and physical damage scenarios
3. **Visualization Engine**: Chart.js for interactive time-series plots, HTML5 Canvas for network visualization, multiple layout algorithms
4. **Data Management Layer**: JSON-based network configuration, CSV export capabilities

---

## Research Applications

### Cyber-Physical Security Research
ACWAverse provides a comprehensive environment for studying attack propagation, system resilience, and defense mechanism effectiveness. Researchers can investigate how cyber-attacks affect physical system behavior, study attack cascading effects, and develop countermeasures for critical infrastructure protection.

### Dataset Generation for Machine Learning
The platform generates diverse attack scenarios with varying parameters, timing, and intensities, creating labeled datasets for training supervised learning models. Supports batch simulation runs with different network configurations, attack types, and environmental conditions.

### Digital Twin Functionality
ACWAverse serves as a digital twin environment for water infrastructure systems, enabling real-time monitoring, predictive maintenance, and cyber-resilience assessment without risk to physical infrastructure.

### Meta-Learning for Attack Detection
By generating diverse attack scenarios and system configurations, ACWAverse enables the training of meta-learning models that can quickly adapt to new attack types and system variations.

---

## Getting Started

### Access the Web Application

ACWAverse is available as a web application. Once deployed via GitHub Pages, access it at:
- `https://AI-VTRC.github.io/ACWAverse/`

### Local Development

1. **Clone the repository**:
   ```bash
   git clone https://github.com/AI-VTRC/ACWAverse.git
   cd ACWAverse
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Build the TypeScript code**:
   ```bash
   npm run build
   ```

4. **Serve the application locally**:
   ```bash
   python -m http.server 8000 --directory src
   # Or use any static file server
   cd src && python -m http.server 8000
   ```

5. **Access the application**:
   Open `http://localhost:8000` in your browser

### Running Tests

```bash
npm test
```

---

## GitHub Pages Deployment

This repository is configured to automatically deploy to GitHub Pages. Follow these steps to enable it:

### 1. Enable GitHub Pages in Repository Settings

1. Go to your repository on GitHub
2. Navigate to **Settings** → **Pages**
3. Under **Source**, select **GitHub Actions** (not "Deploy from a branch")
4. The site will automatically deploy when you push to the `main` branch

### 2. Automatic Deployment

The repository includes a GitHub Actions workflow (`.github/workflows/deploy-pages.yml`) that:
- Builds the TypeScript code
- Copies all necessary files from `src/` to `docs/`
- Deploys to GitHub Pages

The workflow runs automatically on:
- Every push to the `main` branch
- Manual trigger via the "Actions" tab → "Deploy to GitHub Pages" → "Run workflow"

### 3. Local Deployment Testing

To test the deployment locally:

```bash
# Build and prepare docs folder (for testing)
npm run deploy:local

# Then serve from docs
python -m http.server 8000 --directory docs
```

---

## Project Structure

```
ACWAverse/
├── src/                    # Source files
│   ├── index.html         # Main HTML interface
│   ├── style.css          # Stylesheet
│   ├── acwa.js            # UI logic and visualization
│   ├── acwa-logic.js      # Simulation orchestration
│   ├── acwa-engine.ts     # Core simulation engine (TypeScript)
│   ├── data/              # Network data files
│   │   ├── manifest.json  # Available networks
│   │   └── *.json         # Network configurations
│   ├── dist/              # Compiled TypeScript output
│   └── tests/             # Test suite
├── paper/                 # Research paper and figures
│   ├── main.tex          # LaTeX source
│   ├── main.pdf          # Compiled paper
│   └── images/           # Paper figures
├── docs/                  # Generated files for GitHub Pages (auto-created)
├── .github/workflows/     # GitHub Actions workflows
└── package.json          # Node.js dependencies and scripts
```

---

## Key Innovations

- **Integrated Cyber-Attack Simulation Framework**: Duration-based effects with real-time data poisoning that affects both conditional actions and system visualization
- **Advanced Layout Algorithms**: Topological sorting, balanced positioning, and compact layouts for optimal network representation
- **Real-Time Data Poisoning with Visual Feedback**: Injects false sensor readings for specified durations, affecting both conditional action evaluation and graph visualization
- **Comprehensive Sample Systems**: Pre-configured systems ranging from simple loops to complex real-world topologies like the Muleshoe Water System
- **Web-Based Accessibility**: Runs entirely in modern browsers, providing cross-platform compatibility without installation requirements

---

## Case Studies

### 4-Tank Conditional Loop
Demonstrates integrated cyber-attack framework and conditional control logic with data poisoning attacks targeting tank level sensors.

### ACWA Topologies Network
Showcases ability to handle complex network topologies with multiple attack scenarios including data poisoning, chemical interference, and physical damage.

### Muleshoe Water System
Real-world topology demonstrating ACWAverse's capability to model municipal water distribution networks with realistic flow rates, tank capacities, and operational parameters.

---

## Performance

Performance evaluations demonstrate efficient browser-based simulation capabilities:
- Complex networks (50+ nodes, 70+ pipes): 24-hour simulations complete within seconds
- Memory utilization: 100-component network uses under 100MB of browser memory
- Scalability: Networks with over 500 components demonstrate practical performance
- Accuracy: Hydraulic calculations deviate less than 2% from theoretical expectations
- Water quality modeling: Typically within 5% of analytical solutions

---

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

---

## Related Work

This work builds upon and extends the original ACWA project:
- **Original ACWA**: Physical testbed with 2-tank digital twin simulator ([ACWA Lab](https://ai.bse.vt.edu/ACWA_Lab.html))
- **ACWAverse**: Next-generation cyber-physical security research platform with unlimited scalability and integrated cyber-attack simulation

For more information about the ACWA physical testbed and related research, visit:
- [ACWA Data and Paper](https://ai.bse.vt.edu/ACWA_Lab.html)

---

## Research Labs

**A3 Lab (AI Assurance and Applications)**  
[A3 Lab Homepage](https://ai.bse.vt.edu)  
Virginia Tech Research Center (VTRC) 3rd floor  
900 N Glebe Rd, Arlington, VA 22203

**ACWA Lab (AI & Cyber for Water & Ag)**  
[ACWA Lab Homepage](https://ai.bse.vt.edu/ACWA_Lab.html)  
1230 Washington St SW, Blacksburg, VA 24061

---

## Authors

- **Mehmet Oguz Yardimci** - Department of Computer Science, Virginia Tech  
  - Email: oguzy@vt.edu
  - LinkedIn: [Mehmet Oguz Yardimci](https://www.linkedin.com/in/oguzyardimci/)

- **Feras A. Batarseh** - Department of Biological Systems Engineering, Virginia Tech  
  - Email: batarseh@vt.edu


## Acknowledgments

This work leverages the facilities of the ACWA Laboratory at Virginia Tech, including its instrumented physical testbed, PLC infrastructure, and curated datasets, which informed ACWAverse's requirements and provided ground truth for validation.

---

## Contact

For questions, collaborations, or contributions, please contact:
- **Mehmet Oguz Yardimci**: oguzy@vt.edu
- **Feras A. Batarseh**: batarseh@vt.edu

Visit our labs:
- [A3 Lab](https://ai.bse.vt.edu)
- [ACWA Lab](https://ai.bse.vt.edu/ACWA_Lab.html)
