// --- Global State ---
let systemName = "Untitled System";
let network = {};
let controlActions = [];
let conditionalActions = [];
let attackScenarios = [];
let componentCounter = {};
let lastSimulationResults = null;
let activeCharts = [];

// --- Data ---
let sampleSystems = [];

// Export minimal API to window for other scripts
window.ACWA = {
  getState: () => ({ systemName, network, controlActions, conditionalActions, attackScenarios, componentCounter, lastSimulationResults, activeCharts, sampleSystems }),
  setState: (partial) => {
    if (!partial || typeof partial !== 'object') return;
    if (partial.systemName !== undefined) systemName = partial.systemName;
    if (partial.network !== undefined) network = partial.network;
    if (partial.controlActions !== undefined) controlActions = partial.controlActions;
    if (partial.conditionalActions !== undefined) conditionalActions = partial.conditionalActions;
    if (partial.attackScenarios !== undefined) attackScenarios = partial.attackScenarios;
    if (partial.componentCounter !== undefined) componentCounter = partial.componentCounter;
    if (partial.lastSimulationResults !== undefined) lastSimulationResults = partial.lastSimulationResults;
    if (partial.activeCharts !== undefined) activeCharts = partial.activeCharts;
    if (partial.sampleSystems !== undefined) sampleSystems = partial.sampleSystems;
  }
};
