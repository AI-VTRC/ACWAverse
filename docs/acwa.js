

// --- Simple HTML Visualization ---
let isVisInitialized = false;

//don't test this
function initVisualization() {
    const container = document.getElementById('network-visualizer-container');
    const content = document.getElementById('network-visualizer-content');
    if (!container || !content) return;
    
    // Clear existing content
    content.innerHTML = '';
    
    isVisInitialized = true;
}

//don't test this
function updateVisualization() {
    if (!isVisInitialized) {
        initVisualization();
    }
    
    const content = document.getElementById('network-visualizer-content');
    if (!content) return;
    
    // Clear existing content
    content.innerHTML = '';
    
    // Create component nodes
    if (network.components) {
        network.components.forEach((comp, index) => createComponentVisual(comp, index));
    }
    
    // Create pipe connections
    if (network.pipes) {
        network.pipes.forEach(pipe => createPipeVisual(pipe));
    }
    
    // Update layout information
    updateLayoutInfo();
}

// Add window resize handler for dynamic layout
//don't test this
function handleWindowResize() {
    if (isVisInitialized && network.components && network.components.length > 0) {
        updateVisualization();
    }
}

// Topological ordering functions
//don't test this
function buildGraph() {
    const graph = {};
    const inDegree = {};
    
    // Initialize graph and in-degree
    network.components.forEach(comp => {
        graph[comp.id] = [];
        inDegree[comp.id] = 0;
    });
    
    // Build adjacency list and calculate in-degrees
    network.pipes.forEach(pipe => {
        if (graph[pipe.from] && graph[pipe.to]) {
            graph[pipe.from].push(pipe.to);
            inDegree[pipe.to]++;
        }
    });
    
    return { graph, inDegree };
}

//don't test this
function topologicalSort() {
    const { graph, inDegree } = buildGraph();
    const queue = [];
    const result = [];
    const visited = new Set();
    
    // Add all nodes with in-degree 0 to queue
    Object.keys(inDegree).forEach(node => {
        if (inDegree[node] === 0) {
            queue.push(node);
        }
    });
    
    // Process queue
    while (queue.length > 0) {
        const current = queue.shift();
        result.push(current);
        visited.add(current);
        
        // Reduce in-degree of neighbors
        graph[current].forEach(neighbor => {
            inDegree[neighbor]--;
            if (inDegree[neighbor] === 0 && !visited.has(neighbor)) {
                queue.push(neighbor);
            }
        });
    }
    
    // Handle cycles by adding remaining nodes
    Object.keys(inDegree).forEach(node => {
        if (!visited.has(node)) {
            result.push(node);
        }
    });
    
    return result;
}

//don't test this
function calculateBalancedPositions() {
    const { graph, inDegree } = buildGraph();
    const positions = {};
    
    // Step 1: Identify component types and their roles
    const sources = [];
    const sinks = [];
    const intermediates = [];
    const isolated = [];
    
    network.components.forEach(comp => {
        const hasIncoming = inDegree[comp.id] > 0;
        const hasOutgoing = graph[comp.id] && graph[comp.id].length > 0;
        
        if (!hasIncoming && !hasOutgoing) {
            isolated.push(comp.id);
        } else if (!hasIncoming) {
            sources.push(comp.id);
        } else if (!hasOutgoing) {
            sinks.push(comp.id);
        } else {
            intermediates.push(comp.id);
        }
    });
    
    // Step 2: Calculate positions with generous spacing
    const margin = 80;
    const minSpacing = 120; // Fixed minimum distance
    const maxWidth = 800;
    const maxHeight = 600;
    
    // Position sources at the top
    const sourceY = margin;
    sources.forEach((compId, index) => {
        const x = margin + (index * minSpacing);
        positions[compId] = { x, y: sourceY };
    });
    
    // Position sinks at the bottom
    const sinkY = maxHeight - margin;
    sinks.forEach((compId, index) => {
        const x = margin + (index * minSpacing);
        positions[compId] = { x, y: sinkY };
    });
    
    // Position intermediates in a grid pattern
    if (intermediates.length > 0) {
        const availableWidth = maxWidth - 2 * margin;
        const availableHeight = sinkY - sourceY - 2 * margin;
        const maxPerRow = Math.floor(availableWidth / minSpacing);
        const rows = Math.ceil(intermediates.length / maxPerRow);
        const rowSpacing = Math.max(minSpacing, availableHeight / (rows + 1));
        
        intermediates.forEach((compId, index) => {
            const row = Math.floor(index / maxPerRow);
            const col = index % maxPerRow;
            const x = margin + (col * minSpacing);
            const y = sourceY + margin + ((row + 1) * rowSpacing);
            positions[compId] = { x, y };
        });
    }
    
    // Position isolated components on the right
    isolated.forEach((compId, index) => {
        const x = maxWidth - margin - (index * minSpacing);
        const y = margin + (index * minSpacing);
        positions[compId] = { x, y };
    });
    
    return positions;
}

//don't test this
function calculateTopologicalPositions() {
    const topoOrder = topologicalSort();
    const positions = {};
    
    // Group components by their topological level
    const levelGroups = {};
    const visited = new Set();
    const level = {};
    
    // Initialize levels
    topoOrder.forEach(compId => {
        level[compId] = 0;
    });
    
    // Calculate level for each component using BFS
    const { graph, inDegree } = buildGraph();
    const queue = [];
    
    // Start with components that have in-degree 0 (sources or isolated components)
    topoOrder.forEach(compId => {
        if (inDegree[compId] === 0) {
            queue.push({ id: compId, level: 0 });
            level[compId] = 0;
            visited.add(compId);
        }
    });
    
    // Process queue to assign levels
    while (queue.length > 0) {
        const { id: currentId, level: currentLevel } = queue.shift();
        
        // Add neighbors to queue with incremented level
        if (graph[currentId]) {
            graph[currentId].forEach(neighborId => {
                if (!visited.has(neighborId)) {
                    const newLevel = currentLevel + 1;
                    level[neighborId] = newLevel;
                    queue.push({ id: neighborId, level: newLevel });
                    visited.add(neighborId);
                }
            });
        }
    }
    
    // Handle disconnected components (not reachable from any source)
    topoOrder.forEach(compId => {
        if (!visited.has(compId)) {
            // Find the minimum level among all components that have edges to this component
            let minLevel = 0;
            let hasIncoming = false;
            
            Object.keys(graph).forEach(fromId => {
                if (graph[fromId] && graph[fromId].includes(compId)) {
                    hasIncoming = true;
                    const fromLevel = level[fromId] || 0;
                    minLevel = Math.max(minLevel, fromLevel + 1);
                }
            });
            
            if (!hasIncoming) {
                // Isolated component - place at level 0
                level[compId] = 0;
            } else {
                level[compId] = minLevel;
            }
            visited.add(compId);
        }
    });
    
    // Group components by level
    Object.keys(level).forEach(compId => {
        const compLevel = level[compId];
        if (!levelGroups[compLevel]) {
            levelGroups[compLevel] = [];
        }
        levelGroups[compLevel].push(compId);
    });
    
    // Calculate positions for each level with proper spacing
    const margin = 50;
    const levelHeight = 120;
    const horizontalSpacing = 150;
    
    Object.keys(levelGroups).forEach(levelNum => {
        const componentsInLevel = levelGroups[levelNum];
        const y = margin + parseInt(levelNum) * levelHeight;
        
        componentsInLevel.forEach((compId, index) => {
            const x = margin + index * horizontalSpacing;
            positions[compId] = { x, y };
        });
    });
    
    return positions;
}

//don't test this
function calculateCompactPositions() {
    const positions = {};
    const margin = 50;
    const minSpacing = 120; // Fixed spacing like in balanced layout
    const maxPerRow = Math.floor((800 - 2 * margin) / minSpacing);
    
    network.components.forEach((comp, index) => {
        const row = Math.floor(index / maxPerRow);
        const col = index % maxPerRow;
        const x = margin + col * minSpacing;
        const y = margin + row * minSpacing;
        positions[comp.id] = { x, y };
    });
    
    return positions;
}

// Force-directed layout handles spacing automatically
// No need for separate collision detection functions

//don't test this
function optimizePositions(positions, graph) {
    // Simple optimization to reduce edge crossings
    // This is a basic implementation - could be enhanced with more sophisticated algorithms
    
    const components = Object.keys(positions);
    const iterations = 3;
    
    for (let iter = 0; iter < iterations; iter++) {
        components.forEach(compId => {
            const neighbors = graph[compId] || [];
            const incoming = Object.keys(graph).filter(fromId => 
                graph[fromId] && graph[fromId].includes(compId)
            );
            
            // Calculate average position of neighbors
            const allNeighbors = [...neighbors, ...incoming];
            if (allNeighbors.length > 0) {
                let avgX = 0, avgY = 0;
                allNeighbors.forEach(neighborId => {
                    if (positions[neighborId]) {
                        avgX += positions[neighborId].x;
                        avgY += positions[neighborId].y;
                    }
                });
                avgX /= allNeighbors.length;
                avgY /= allNeighbors.length;
                
                // Move component slightly towards average neighbor position
                const currentPos = positions[compId];
                currentPos.x = currentPos.x * 0.8 + avgX * 0.2;
                currentPos.y = currentPos.y * 0.8 + avgY * 0.2;
                
                // Ensure we don't create new collisions
                constrainToBounds(currentPos);
            }
        });
    }
}

let currentLayout = 'balanced';
let layoutDirection = 'vertical'; // 'vertical' or 'horizontal'
let currentZoom = 1; // 1.0 = 100%

//don't test this
function changeLayout() {
    const selector = document.getElementById('layoutSelector');
    currentLayout = selector.value;
    updateVisualization();
}

//don't test this
function setLayoutDirection(dir) {
    if (dir !== 'vertical' && dir !== 'horizontal') return;
    layoutDirection = dir;
    const vBtn = document.getElementById('dir-vertical');
    const hBtn = document.getElementById('dir-horizontal');
    if (vBtn && hBtn) {
        if (layoutDirection === 'vertical') {
            vBtn.classList.remove('bg-gray-200');
            vBtn.classList.add('bg-blue-500','text-white');
            hBtn.classList.remove('bg-blue-500','text-white');
            hBtn.classList.add('bg-gray-200','text-gray-800');
        } else {
            hBtn.classList.remove('bg-gray-200');
            hBtn.classList.add('bg-blue-500','text-white');
            vBtn.classList.remove('bg-blue-500','text-white');
            vBtn.classList.add('bg-gray-200','text-gray-800');
        }
    }
    updateVisualization();
}

//don't test this
function orientPositions(positions) {
    if (layoutDirection === 'vertical') return positions;
    const oriented = {};
    Object.keys(positions).forEach(id => {
        const p = positions[id];
        oriented[id] = { x: p.y, y: p.x };
    });
    return oriented;
}

//don't test this
function setZoom(valuePercent) {
    const content = document.getElementById('network-visualizer-content');
    const label = document.getElementById('zoomLabel');
    const range = document.getElementById('zoomRange');
    const percent = typeof valuePercent === 'string' ? parseFloat(valuePercent) : valuePercent;
    if (!content || isNaN(percent)) return;
    currentZoom = Math.max(0.1, percent / 100);
    content.style.transform = `scale(${currentZoom})`;
    if (label) label.textContent = `${Math.round(currentZoom * 100)}%`;
    if (range && Math.round(range.value) !== Math.round(currentZoom * 100)) {
        range.value = Math.round(currentZoom * 100);
    }
}

//don't test this
function createComponentVisual(component, index) {
    const content = document.getElementById('network-visualizer-content');
    if (!content) return;
    
    // Get positions based on current layout
    let positions;
    switch (currentLayout) {
        case 'topological':
            positions = orientPositions(calculateTopologicalPositions());
            break;
        case 'compact':
            positions = orientPositions(calculateCompactPositions());
            break;
        case 'balanced':
        default:
            positions = orientPositions(calculateBalancedPositions());
            break;
    }
    
    const position = positions[component.id] || { x: 100, y: 100 };
    
    // Store position for pipe calculations
    component.position = position;
    
    const node = document.createElement('div');
    node.className = `component-node ${component.type}`;
    node.textContent = component.id;
    node.style.left = `${position.x - 25}px`;
    node.style.top = `${position.y - 25}px`;
    node.onclick = () => openSelectionModal(component.id);
    
    content.appendChild(node);
}

//don't test this
function updateLayoutInfo() {
    const layoutInfo = document.getElementById('layout-info');
    if (layoutInfo && network.components) {
        const totalComponents = network.components.length;
        const { graph, inDegree } = buildGraph();
        
        // Count component types
        const sources = network.components.filter(comp => inDegree[comp.id] === 0 && (graph[comp.id] && graph[comp.id].length > 0)).length;
        const sinks = network.components.filter(comp => (graph[comp.id] && graph[comp.id].length === 0) && inDegree[comp.id] > 0).length;
        const intermediates = network.components.filter(comp => inDegree[comp.id] > 0 && (graph[comp.id] && graph[comp.id].length > 0)).length;
        const isolated = network.components.filter(comp => inDegree[comp.id] === 0 && (!graph[comp.id] || graph[comp.id].length === 0)).length;
        
        const dirLabel = layoutDirection === 'vertical' ? 'Vertical' : 'Horizontal';
        const layoutLabel = currentLayout.charAt(0).toUpperCase() + currentLayout.slice(1);
        layoutInfo.textContent = `Layout: ${layoutLabel} • ${dirLabel} (${totalComponents} components) - Sources: ${sources}, Sinks: ${sinks}, Intermediates: ${intermediates}, Isolated: ${isolated}`;
    }
}

//don't test this
function createPipeVisual(pipe) {
    const content = document.getElementById('network-visualizer-content');
    if (!content) return;
    
    const fromComp = network.components.find(c => c.id === pipe.from);
    const toComp = network.components.find(c => c.id === pipe.to);
    
    if (!fromComp || !toComp || !fromComp.position || !toComp.position) return;
    
    const fromX = fromComp.position.x;
    const fromY = fromComp.position.y;
    const toX = toComp.position.x;
    const toY = toComp.position.y;
    
    // Calculate line properties
    const dx = toX - fromX;
    const dy = toY - fromY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    
    // Component radius (25px from center to edge)
    const componentRadius = 25;
    
    // Calculate intersection points with component borders
    const normalizedDx = dx / distance;
    const normalizedDy = dy / distance;
    
    // Start point (from component border)
    const startX = fromX + normalizedDx * componentRadius;
    const startY = fromY + normalizedDy * componentRadius;
    
    // End point (to component border)
    const endX = toX - normalizedDx * componentRadius;
    const endY = toY - normalizedDy * componentRadius;
    
    // Calculate new line properties
    const newDx = endX - startX;
    const newDy = endY - startY;
    const newDistance = Math.sqrt(newDx * newDx + newDy * newDy);
    const newAngle = Math.atan2(newDy, newDx) * 180 / Math.PI;
    
    // Create line
    const line = document.createElement('div');
    line.className = 'pipe-line';
    line.style.left = `${startX}px`;
    line.style.top = `${startY - 1}px`;
    line.style.width = `${newDistance}px`;
    line.style.transform = `rotate(${newAngle}deg)`;
    
    content.appendChild(line);
    
    // Create arrow at the end point
    const arrow = document.createElement('div');
    arrow.className = 'pipe-arrow';
    
    // The arrow is created using CSS borders pointing right
    // We need to position it so the tip touches the component border
    const arrowWidth = 10; // Width of the arrow (border-left width)
    const arrowHeight = 10; // Height of the arrow (border-top + border-bottom)
    
    // Calculate the position for the arrow base (left edge) so the tip touches the component border
    // The arrow points in the direction of the line, so we need to position it accordingly
    
    // Calculate the position of the arrow base (left edge) so the tip touches the border
    // We need to move back from the border point in the direction of the line
    const angleRad = newAngle * Math.PI / 180;
    const arrowBaseX = endX - arrowWidth * Math.cos(angleRad);
    const arrowBaseY = endY - arrowWidth * Math.sin(angleRad);
    
    arrow.style.left = `${arrowBaseX}px`;
    arrow.style.top = `${arrowBaseY - arrowHeight/2}px`;
    arrow.style.transform = `rotate(${newAngle}deg)`;
    
    content.appendChild(arrow);
    
    // Debug: Log arrow positioning
    // console.log(`Arrow for ${pipe.from} -> ${pipe.to}:`, {
    //     endX, endY, newAngle,
    //     arrowLeft: arrow.style.left,
    //     arrowTop: arrow.style.top,
    //     arrowTransform: arrow.style.transform,
    //     arrowTipPosition: `${endX}px`, // This is where the tip touches
    //     arrowBasePosition: `${arrowBaseX}px, ${arrowBaseY}px` // This is where the base is positioned
    // });
}

// --- UI and App Logic ---
document.addEventListener('DOMContentLoaded', async () => {
    updateControlActionParams();
    updateConditionalActionParams();
    
    // Try to load samples from external JSON manifest
    try {
        const res = await fetch('data/manifest.json', { cache: 'no-store' });
        if (res.ok) {
            const manifest = await res.json();
            if (manifest && Array.isArray(manifest.samples)) {
                const loaded = [];
                for (const entry of manifest.samples) {
                    try {
                        const r = await fetch(`data/${entry.file}`, { cache: 'no-store' });
                        if (r.ok) {
                            const sys = await r.json();
                            loaded.push(sys);
                        }
                    } catch (e) { console.warn('Failed to load sample', entry, e); }
                }
                if (loaded.length > 0) {
                    sampleSystems = loaded;
                }
            }
        }
    } catch (e) { console.warn('Manifest load failed, using embedded samples', e); }

    populateSampleSystemsList();

    // Initialize with the first sample system by default
    if (sampleSystems.length > 0) {
        loadSystem(JSON.parse(JSON.stringify(sampleSystems[0])));
    }
    
    // Add window resize listener for dynamic layout
    window.addEventListener('resize', handleWindowResize);

    // Initialize zoom UI
    setZoom(100);

    // Initialize layout direction UI
    setLayoutDirection('vertical');

    const pdComponentSelect = document.getElementById('pdComponent');
    if (pdComponentSelect) {
        pdComponentSelect.addEventListener('change', updatePhysicalDamageOptions);
    }
});

//don't test this
function populateSampleSystemsList() {
    const select = document.getElementById('sampleSystemsList');
    select.innerHTML = '';
    sampleSystems.forEach((sys, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = sys.name;
        select.appendChild(option);
    });
}

//don't test this
function loadSelectedSampleSystem() {
    const selectedIndex = document.getElementById('sampleSystemsList').value;
    if (selectedIndex >= 0 && selectedIndex < sampleSystems.length) {
        loadSystem(JSON.parse(JSON.stringify(sampleSystems[selectedIndex])));
    }
}

//don't test this
function createNewSystem() {
    const newSystem = {
        name: "New Untitled System",
        network: { components: [], pipes: [] },
        controlActions: [],
        conditionalActions: [],
        attackScenarios: [],
        simulationSettings: { duration: 600, ambientTemp: 20 }
    };
    loadSystem(newSystem);
}

//don't test this
function loadSystem(systemData) {
    systemName = systemData.name || "Untitled System";
    console.log('Loading system:', systemName); // Debug log
    network = systemData.network || { components: [], pipes: [] };
    controlActions = systemData.controlActions || [];
    conditionalActions = systemData.conditionalActions || [];
    attackScenarios = systemData.attackScenarios || [];
    
    const simSettings = systemData.simulationSettings || { duration: 600, ambientTemp: 20 };
    document.getElementById('simDuration').value = simSettings.duration;
    document.getElementById('ambientTemp').value = simSettings.ambientTemp;
    
    componentCounter = {};
    network.components.forEach(c => {
        const [type, numStr] = c.id.split('_');
        const num = parseInt(numStr);
        if (!isNaN(num)) {
            if(!componentCounter[type] || num >= componentCounter[type]) componentCounter[type] = num + 1;
        }
    });
    
    // Calculate initial water amount from level for tanks
    network.components.filter(c => c.type === 'tank').forEach(tank => {
        const shape = (tank.shape || 'cylindrical').toLowerCase();
        let area;
        if (shape === 'rectangular') {
            const width = (typeof tank.width === 'number' && tank.width > 0) ? tank.width : 1;
            const depth = (typeof tank.height === 'number' && tank.height > 0) ? tank.height : 1;
            tank.width = width;
            tank.height = depth;
            area = width * depth;
        } else {
            const radius = (typeof tank.radius === 'number' && tank.radius > 0) ? tank.radius : 1;
            tank.radius = radius;
            area = Math.PI * radius * radius;
        }
        tank.waterAmount = (typeof tank.waterLevel === 'number' ? tank.waterLevel : 0) * area;
    });

    showMainSimulatorView(); // Show the view first
    
    // Initialize visualization after DOM is ready
    setTimeout(() => {
        initVisualization();
        updateVisualization();
    }, 100);

    updateAllDropdowns();
    updateInitialConditions();
    updatePipeList();
    updateControlActionsTable();
    updateConditionalActionsTable();
    updateAttacksTable();
    resetAnalysisTab();
    
    document.getElementById('system-name-display').textContent = systemName;
    console.log('Updated system name display to:', systemName); // Debug log
}

function showMainSimulatorView() {
    document.getElementById('system-management-view').style.display = 'none';
    document.getElementById('main-simulator-view').style.display = 'block';
}

function showSystemManagementView() {
    document.getElementById('system-management-view').style.display = 'block';
    document.getElementById('main-simulator-view').style.display = 'none';
}

//don't test this
function setActiveTab(tabName) {
    document.querySelectorAll(".tab-content").forEach(el => {
        el.style.display = "none";
        el.classList.remove("active");
    });
    document.querySelectorAll(".tab-button").forEach(el => el.classList.remove("active"));

    const content = document.getElementById(tabName);
    if (content) {
        content.style.display = "block";
        content.classList.add("active");
    }

    const button = document.getElementById(`tab-btn-${tabName}`);
    if (button) {
        button.classList.add("active");
    }

    if (tabName === 'build') {
        setTimeout(() => {
            updateVisualization();
        }, 50);
    }
}

//don't test this
function changeTab(event, tabName) {
    setActiveTab(tabName);
    if (event && event.currentTarget) {
        event.currentTarget.classList.add("active");
    }
}

//don't test this
function addComponent(type, options = {}) {
    if (!componentCounter[type]) componentCounter[type] = 1;
    const id = `${type}_${componentCounter[type]++}`;
    const component = { id, type, ...options, waterLevel: 0, waterAmount: 0, temperature: 20, ph: 7, o2: 8, bodn: 2, nitrate: 1, co2: 5 };
    
    // Add default physical properties
    if (type === 'tank') {
        component.maxLevel = 10;
        const shape = (component.shape || 'cylindrical').toLowerCase();
        if (shape === 'rectangular') {
            component.width = component.width !== undefined ? component.width : 2;
            component.height = component.height !== undefined ? component.height : 2;
        } else {
            component.radius = component.radius !== undefined ? component.radius : 1;
        }
    }
    if (type === 'pump') {
        component.maxFlowRate = 0.5;
        component.power = 0;
    }
    if (type === 'valve') {
        component.isOpen = true;
        component.flowRate = 0;
    }

    network.components.push(component);
    updateVisualization();
    updateAllDropdowns();
    updateInitialConditions();
    closeTankModal();
    resetAnalysisTab();
}

//don't test this
function openTankModal() { document.getElementById('tankModal').style.display = 'block'; }

//don't test this
function closeTankModal() { document.getElementById('tankModal').style.display = 'none'; }

//don't test this
function openConnectivityModal() {
    generateConnectivityMatrix();
    document.getElementById('connectivityModal').style.display = 'block';
}

//don't test this
function closeConnectivityModal() { 
    document.getElementById('connectivityModal').style.display = 'none'; 
}

//don't test this
function generateConnectivityMatrix() {
    const matrixContainer = document.getElementById('connectivityMatrix');
    if (!network.components || network.components.length === 0) {
        matrixContainer.innerHTML = '<p class="text-gray-500 text-center py-4">No components available. Add some components first.</p>';
        return;
    }

    const table = document.createElement('table');
    table.className = 'connectivity-matrix';
    
    // Create header row
    const headerRow = document.createElement('tr');
    headerRow.innerHTML = '<th>From/To</th>';
    network.components.forEach(comp => {
        const th = document.createElement('th');
        th.innerHTML = `${comp.id}<br><span class="component-type-badge badge-${comp.type}">${comp.type}</span>`;
        headerRow.appendChild(th);
    });
    table.appendChild(headerRow);
    
    // Create data rows
    network.components.forEach(fromComp => {
        const row = document.createElement('tr');
        
        // First cell (row header)
        const rowHeader = document.createElement('td');
        rowHeader.innerHTML = `${fromComp.id}<br><span class="component-type-badge badge-${fromComp.type}">${fromComp.type}</span>`;
        row.appendChild(rowHeader);
        
        // Data cells
        network.components.forEach(toComp => {
            const cell = document.createElement('td');
            
            // Don't allow self-connections
            if (fromComp.id === toComp.id) {
                cell.innerHTML = '<span class="text-gray-400">-</span>';
            } else {
                // Check if this connection already exists
                const existingConnection = network.pipes.find(pipe => 
                    pipe.from === fromComp.id && pipe.to === toComp.id
                );
                
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.className = 'connectivity-checkbox';
                checkbox.checked = !!existingConnection;
                checkbox.onchange = () => handleConnectionChange(fromComp.id, toComp.id, checkbox.checked);
                
                cell.appendChild(checkbox);
            }
            
            row.appendChild(cell);
        });
        
        table.appendChild(row);
    });
    
    matrixContainer.innerHTML = '';
    matrixContainer.appendChild(table);
}

//don't test this
function handleConnectionChange(fromId, toId, isConnected) {
    if (isConnected) {
        // Add connection
        const pipeId = `pipe_${network.pipes.length + 1}`;
        network.pipes.push({ id: pipeId, from: fromId, to: toId });
    } else {
        // Remove connection
        const index = network.pipes.findIndex(pipe => pipe.from === fromId && pipe.to === toId);
        if (index !== -1) {
            network.pipes.splice(index, 1);
        }
    }
    
    updateVisualization();
    resetAnalysisTab();
}

//don't test this
function clearAllConnections() {
    network.pipes = [];
    updateVisualization();
    resetAnalysisTab();
    generateConnectivityMatrix(); // Refresh the matrix
}

//don't test this
function deleteSelectedComponent() {
    const componentId = document.getElementById('selectedComponentId').textContent;
    if (!componentId) return;

    // Remove component
    network.components = network.components.filter(c => c.id !== componentId);

    // Remove connected pipes
    network.pipes = network.pipes.filter(p => p.from !== componentId && p.to !== componentId);

    // Update everything
    updateVisualization();
    updateAllDropdowns();
    updateInitialConditions();
    updatePipeList();
    resetAnalysisTab();
    closeSelectionModal();
}

//don't test this
function updatePipeList() {
    // Update pipe-related UI elements if they exist
    // This function exists to prevent errors when called from other functions
    // console.log('Pipe list updated - pipes:', network.pipes.length);
}

//don't test this
function updateAllDropdowns() {
    const selects = [
        document.getElementById('controlComponent'), 
        document.getElementById('ciComponent'), document.getElementById('cdComponent'),
        document.getElementById('pdComponent'), document.getElementById('dpComponent'),
        document.getElementById('analysisComponent'),
        document.getElementById('cond_source_comp'), document.getElementById('cond_target_comp'),
        document.getElementById('editControlComponent')
    ];
    const valueSelects = [document.getElementById('cond_source_val')];

    const getAllowedTypesForSelect = (selectId) => {
        switch (selectId) {
            case 'cdComponent':
            case 'ciComponent':
                return ['tank'];
            case 'pdComponent':
                return ['tank', 'pump', 'valve'];
            case 'controlComponent':
            case 'editControlComponent':
                return ['pump', 'valve'];
            case 'cond_target_comp':
                return ['pump', 'valve'];
            // For general controls/analysis/poisoning/conditionals allow all types
            default:
                return ['source', 'pump', 'valve', 'junction', 'tank', 'sink'];
        }
    };

    selects.forEach(select => {
        if (select) {
            const currentVal = select.value;
            const selectId = select.id;
            const allowedTypes = new Set(getAllowedTypesForSelect(selectId));

            select.innerHTML = '';

            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = 'Select component';
            placeholder.disabled = true;
            placeholder.selected = true;
            select.appendChild(placeholder);

            network.components
                .filter(comp => allowedTypes.has(comp.type))
                .forEach(comp => {
                    const option = document.createElement('option');
                    option.value = comp.id;
                    option.textContent = comp.id;
                    select.appendChild(option);
                });

            // Restore previous value if still available
            if (currentVal && Array.from(select.options).some(o => o.value === currentVal)) {
                select.value = currentVal;
            }
        }
    });

    handleControlComponentChange();
    handleEditControlComponentChange();
    handleConditionalTargetChange();
    updatePhysicalDamageOptions();
    
    valueSelects.forEach(select => {
        if(select) {
            const currentVal = select.value;
            select.innerHTML = '';
            ['waterLevel', 'waterAmount', 'temperature', 'ph', 'o2', 'bodn', 'nitrate', 'co2', 'power'].forEach(val => {
                const option = document.createElement('option');
                option.value = val;
                option.textContent = val;
                select.appendChild(option);
            });
            select.value = currentVal;
        }
    });
}

function updatePhysicalDamageOptions() {
    const pdType = document.getElementById('pdType');
    if (!pdType) return;
    const pdCompSel = document.getElementById('pdComponent');

    // Always start with every option visible
    Array.from(pdType.options).forEach(opt => { opt.hidden = false; });

    if (!pdCompSel || !network || !Array.isArray(network.components)) {
        return;
    }

    const comp = network.components.find(c => c.id === pdCompSel.value);
    if (!comp) {
        // Nothing selected yet; ensure no option is inadvertently hidden
        if (!pdType.value) {
            const firstVisible = Array.from(pdType.options).find(o => !o.hidden && o.value);
            if (firstVisible) pdType.value = firstVisible.value;
        }
        return;
    }

    const isTank = comp.type === 'tank';
    const isPump = comp.type === 'pump';
    const isValve = comp.type === 'valve';

    Array.from(pdType.options).forEach(opt => {
        if (opt.value === 'leak' && !isTank) opt.hidden = true;
        if (opt.value === 'pump_failure' && !isPump) opt.hidden = true;
        if (opt.value === 'valve_stuck' && !isValve) opt.hidden = true;
    });

    if (pdType.selectedOptions.length && pdType.selectedOptions[0].hidden) {
        const firstVisible = Array.from(pdType.options).find(o => !o.hidden && o.value);
        pdType.value = firstVisible ? firstVisible.value : '';
    } else if (!pdType.value) {
        const firstVisible = Array.from(pdType.options).find(o => !o.hidden && o.value);
        if (firstVisible) pdType.value = firstVisible.value;
    }
}

//don't test this
function updateInitialConditions() {
    const container = document.getElementById('initial-conditions-container');
    container.innerHTML = '';
    if (!network.components) return;

    network.components.forEach(comp => {
        if (comp.type === 'pump' && typeof comp.power !== 'number') comp.power = 0;
        if (comp.type === 'valve') {
            if (typeof comp.isOpen !== 'boolean') comp.isOpen = true;
            if (typeof comp.flowRate !== 'number') comp.flowRate = 0;
        }

        const baseFields = INITIAL_PARAM_CONFIG[comp.type] || [];
        let shapeFields = [];

        if (comp.type === 'tank') {
            const shape = (comp.shape || 'cylindrical').toLowerCase();
            if (shape === 'rectangular') {
                if (!(typeof comp.width === 'number' && comp.width > 0)) comp.width = 2;
                if (!(typeof comp.height === 'number' && comp.height > 0)) comp.height = 2;
                shapeFields = [
                    { key: 'width', label: 'Width', type: 'number', unit: '(m)', min: 0, step: '0.1', defaultValue: 2 },
                    { key: 'height', label: 'Height', type: 'number', unit: '(m)', min: 0, step: '0.1', defaultValue: 2 }
                ];
            } else {
                if (!(typeof comp.radius === 'number' && comp.radius > 0)) comp.radius = 1;
                shapeFields = [
                    { key: 'radius', label: 'Radius', type: 'number', unit: '(m)', min: 0, step: '0.1', defaultValue: 1 }
                ];
            }
        }

        const allFields = [...shapeFields, ...baseFields];
        let fieldsHtml;

        if (allFields.length === 0) {
            fieldsHtml = '<p class="text-sm text-gray-500 italic">No adjustable parameters.</p>';
        } else {
            fieldsHtml = allFields.map(field => {
                const rawValue = comp[field.key];
                const defaultValue = field.defaultValue !== undefined ? field.defaultValue : '';
                let value = rawValue !== undefined ? rawValue : defaultValue;
                if (field.type === 'number' && (value === '' || value === undefined || value === null)) value = 0;
                if (field.type === 'select') value = String(value);

                if (field.type === 'number') {
                    const attrs = [
                        `type="number"`,
                        `data-id="${comp.id}"`,
                        `data-param="${field.key}"`,
                        `data-type="number"`,
                        `value="${value}"`
                    ];
                    if (field.min !== undefined) attrs.push(`min="${field.min}"`);
                    if (field.max !== undefined) attrs.push(`max="${field.max}"`);
                    if (field.step !== undefined) attrs.push(`step="${field.step}"`);
                    const unit = field.unit ? ` ${field.unit}` : '';
                    return `<div>
                                <label class="block text-xs font-medium text-gray-500">${field.label} ${unit}</label>
                                <input ${attrs.join(' ')} class="w-full rounded-md p-1 border-gray-300 shadow-sm sm:text-sm">
                            </div>`;
                }

                if (field.type === 'select') {
                    const options = (field.options || []).map(opt => {
                        const selected = opt.value === value ? 'selected' : '';
                        return `<option value="${opt.value}" ${selected}>${opt.label}</option>`;
                    }).join('');
                    return `<div>
                                <label class="block text-xs font-medium text-gray-500">${field.label}</label>
                                <select data-id="${comp.id}" data-param="${field.key}" data-type="boolean" class="w-full rounded-md p-1 border-gray-300 shadow-sm sm:text-sm">
                                    ${options}
                                </select>
                            </div>`;
                }

                return '';
            }).join('');
        }

        const div = document.createElement('div');
        div.className = 'p-3 border rounded-lg';
        div.innerHTML = `<h4 class="font-medium">${comp.id} (${comp.type})</h4>
                         <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mt-2">
                             ${fieldsHtml}
                         </div>`;
        container.appendChild(div);
    });
}

const INITIAL_PARAM_CONFIG = {
    tank: [
        { key: 'waterLevel', label: 'Water Level', type: 'number', unit: '(m)', min: 0, step: '0.1' },
        { key: 'temperature', label: 'Temperature', type: 'number', unit: '(°C)', step: '0.1' },
        { key: 'ph', label: 'pH', type: 'number', unit: '(pH)', step: '0.1' },
        { key: 'o2', label: 'Dissolved O₂', type: 'number', unit: '(mg/L)', step: '0.1' },
        { key: 'bodn', label: 'BODn', type: 'number', unit: '(mg/L)', step: '0.1' },
        { key: 'nitrate', label: 'Nitrate', type: 'number', unit: '(mg/L)', step: '0.1' },
        { key: 'co2', label: 'CO₂', type: 'number', unit: '(mg/L)', step: '0.1' }
    ],
    pump: [
        { key: 'power', label: 'Initial Power', type: 'number', unit: '(%)', min: 0, max: 100, step: '1', defaultValue: 0 },
        { key: 'maxFlowRate', label: 'Max Flow Rate', type: 'number', unit: '(m³/s)', min: 0, step: '0.1' }
    ],
    valve: [
        { key: 'isOpen', label: 'Initial State', type: 'select', options: [ { value: 'true', label: 'Open' }, { value: 'false', label: 'Closed' } ], defaultValue: 'true' },
        { key: 'flowRate', label: 'Nominal Flow Rate', type: 'number', unit: '(m³/s)', min: 0, step: '0.1', defaultValue: 0 }
    ],
    source: [
        { key: 'head', label: 'Head', type: 'number', unit: '(m)', step: '0.1' },
        { key: 'waterLevel', label: 'Water Level', type: 'number', unit: '(m)', min: 0, step: '0.1' },
        { key: 'temperature', label: 'Temperature', type: 'number', unit: '(°C)', step: '0.1' },
        { key: 'ph', label: 'pH', type: 'number', unit: '(pH)', step: '0.1' },
        { key: 'o2', label: 'Dissolved O₂', type: 'number', unit: '(mg/L)', step: '0.1' },
        { key: 'bodn', label: 'BODn', type: 'number', unit: '(mg/L)', step: '0.1' },
        { key: 'nitrate', label: 'Nitrate', type: 'number', unit: '(mg/L)', step: '0.1' },
        { key: 'co2', label: 'CO₂', type: 'number', unit: '(mg/L)', step: '0.1' }
    ],
    junction: [],
    sink: [
        { key: 'head', label: 'Head', type: 'number', unit: '(m)', step: '0.1' }
    ]
};

const TIMED_CONTROL_ACTION_LABELS = {
    set_pump_power: 'Set Pump Power',
    set_valve_state: 'Set Valve State',
    set_valve_flow: 'Set Valve Flow'
};

function getTimedActionsForType(type) {
    if (type === 'pump') return ['set_pump_power'];
    if (type === 'valve') return ['set_valve_state', 'set_valve_flow'];
    return [];
}

function updateTimedActionSelectOptions(componentSelectId, actionSelectId, preferredAction) {
    const componentSelect = document.getElementById(componentSelectId);
    const actionSelect = document.getElementById(actionSelectId);
    if (!actionSelect) return;

    const componentId = componentSelect ? componentSelect.value : '';
    const component = network.components.find(c => c.id === componentId);
    const allowedActions = component ? getTimedActionsForType(component.type) : [];

    actionSelect.innerHTML = '';

    allowedActions.forEach(action => {
        const option = document.createElement('option');
        option.value = action;
        option.textContent = TIMED_CONTROL_ACTION_LABELS[action] || action;
        actionSelect.appendChild(option);
    });

    if (allowedActions.length === 0) {
        actionSelect.disabled = true;
        return;
    }

    actionSelect.disabled = false;
    const nextValue = (preferredAction && allowedActions.includes(preferredAction))
        ? preferredAction
        : allowedActions[0];
    actionSelect.value = nextValue;
}

function handleControlComponentChange(preferredAction) {
    updateTimedActionSelectOptions('controlComponent', 'controlAction', preferredAction);
    if (document.getElementById('controlAction')) {
        updateControlActionParams();
    }
}

function handleEditControlComponentChange(preferredAction, params) {
    updateTimedActionSelectOptions('editControlComponent', 'editControlAction', preferredAction);
    if (document.getElementById('editControlAction')) {
        updateEditControlActionParams(preferredAction, params || {});
    }
}

const CONDITIONAL_ACTION_LABELS = {
    set_pump_power: 'Set Pump Power',
    reduce_power: 'Reduce Pump Power',
    increase_power: 'Increase Pump Power',
    emergency_stop: 'Emergency Stop (Pump)',
    set_valve_state: 'Set Valve State',
    set_valve_flow: 'Set Valve Flow',
    emergency_close: 'Emergency Close (Valve)'
};

function getConditionalActionsForType(type) {
    if (type === 'pump') return ['set_pump_power', 'reduce_power', 'increase_power', 'emergency_stop'];
    if (type === 'valve') return ['set_valve_state', 'set_valve_flow', 'emergency_close'];
    return [];
}

function updateConditionalActionSelectOptions(componentSelectId, actionSelectId, preferredAction) {
    const componentSelect = document.getElementById(componentSelectId);
    const actionSelect = document.getElementById(actionSelectId);
    if (!actionSelect) return;

    const componentId = componentSelect ? componentSelect.value : '';
    const component = network.components.find(c => c.id === componentId);
    const allowedActions = component ? getConditionalActionsForType(component.type) : [];

    actionSelect.innerHTML = '';

    allowedActions.forEach(action => {
        const option = document.createElement('option');
        option.value = action;
        option.textContent = CONDITIONAL_ACTION_LABELS[action] || action;
        actionSelect.appendChild(option);
    });

    if (allowedActions.length === 0) {
        actionSelect.disabled = true;
        return;
    }

    actionSelect.disabled = false;
    const nextValue = (preferredAction && allowedActions.includes(preferredAction))
        ? preferredAction
        : allowedActions[0];
    actionSelect.value = nextValue;
}

function handleConditionalTargetChange(preferredAction) {
    updateConditionalActionSelectOptions('cond_target_comp', 'cond_target_action', preferredAction);
    updateConditionalActionParams();
}

//don't test this
function updateControlActionParams() {
    const actionSelect = document.getElementById('controlAction');
    const paramsDiv = document.getElementById('controlActionParams');
    if (!actionSelect || actionSelect.disabled || !actionSelect.value) {
        paramsDiv.innerHTML = '';
        return;
    }
    const action = actionSelect.value;
    if (action === 'set_pump_power') {
        paramsDiv.innerHTML = `<label for="pumpPower" class="block text-sm font-medium text-gray-700">Power (%)</label>
                                <input type="number" id="pumpPower" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2" min="0" max="100" value="100">`;
    } else if (action === 'set_valve_state') {
        paramsDiv.innerHTML = `<label for="valveState" class="block text-sm font-medium text-gray-700">State</label>
                                <select id="valveState" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2"><option value="open">Open</option><option value="closed">Closed</option></select>`;
    } else if (action === 'set_valve_flow') {
        paramsDiv.innerHTML = `<label for="valveFlow" class="block text-sm font-medium text-gray-700">Flow Rate (m³/s)</label>
                                <input type="number" id="valveFlow" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2" min="0" step="0.1" value="1.0">`;
    } else {
        paramsDiv.innerHTML = '';
    }
}

function updateConditionalActionParams() {
    const actionSelect = document.getElementById('cond_target_action');
    const paramsDiv = document.getElementById('conditionalActionParams');
    if (!actionSelect || actionSelect.disabled || !actionSelect.value) {
        paramsDiv.innerHTML = '';
        return;
    }
    const action = actionSelect.value;
    if (action === 'set_pump_power') {
        paramsDiv.innerHTML = `<input type="number" id="cond_pumpPower" class="w-full rounded-md border-gray-300 shadow-sm p-2" min="0" max="100" value="0" placeholder="Power (%)">`;
    } else if (action === 'set_valve_state') {
        paramsDiv.innerHTML = `<select id="cond_valveState" class="w-full rounded-md border-gray-300 shadow-sm p-2"><option value="open">Open</option><option value="closed">Closed</option></select>`;
    } else if (action === 'set_valve_flow') {
        paramsDiv.innerHTML = `<input type="number" id="cond_valveFlow" class="w-full rounded-md border-gray-300 shadow-sm p-2" min="0" step="0.1" value="1.0" placeholder="Flow Rate (m³/s)">`;
    } else if (action === 'reduce_power' || action === 'increase_power') {
        paramsDiv.innerHTML = `<input type="number" id="cond_pumpPower" class="w-full rounded-md border-gray-300 shadow-sm p-2" min="0" max="100" value="50" placeholder="Delta Power (%)">`;
    } else {
        // emergency_stop, emergency_close
        paramsDiv.innerHTML = '';
    }
}

function addControlAction() {
    const time = document.getElementById('controlTime').value;
    const componentId = document.getElementById('controlComponent').value;
    const actionType = document.getElementById('controlAction').value;
    if (!time || !componentId || !actionType) return;
    const component = network.components.find(c => c.id === componentId);
    if (!component) return;
    const allowedActions = getTimedActionsForType(component.type);
    if (!allowedActions.includes(actionType)) {
        alert('Selected action is not compatible with the chosen component.');
        return;
    }
    let params = {};
    if (actionType === 'set_pump_power') params.power = document.getElementById('pumpPower').value;
    else if (actionType === 'set_valve_state') params.state = document.getElementById('valveState').value;
    else if (actionType === 'set_valve_flow') params.flowRate = document.getElementById('valveFlow').value;

    controlActions.push({ time: parseInt(time), componentId, actionType, params });
    controlActions.sort((a, b) => a.time - b.time);
    updateControlActionsTable();
}

function updateControlActionsTable() {
    const tableBody = document.getElementById('controlActionsTable');
    tableBody.innerHTML = '';
    controlActions.forEach((action, index) => {
        const row = tableBody.insertRow();
        row.innerHTML = `<td class="px-6 py-4">${action.time}</td><td class="px-6 py-4">${action.componentId}</td>
                            <td class="px-6 py-4">${action.actionType}</td><td class="px-6 py-4">${JSON.stringify(action.params)}</td>
                            <td class="px-6 py-4 whitespace-nowrap space-x-2">
                            <button onclick="openEditTimedActionModal(${index})" class="text-blue-500 hover:text-blue-700">Edit</button>
                            <button onclick="deleteTimedAction(${index})" class="text-red-500 hover:text-red-700">Delete</button>
                            </td>`;
    });
}
function deleteTimedAction(index) { 
    controlActions.splice(index, 1); 
    updateControlActionsTable(); 
}

function addConditionalAction() {
    const rule = {
        source: {
            componentId: document.getElementById('cond_source_comp').value,
            value: document.getElementById('cond_source_val').value,
        },
        condition: {
            operator: document.getElementById('cond_operator').value,
            threshold: parseFloat(document.getElementById('cond_threshold').value)
        },
        target: {
            componentId: document.getElementById('cond_target_comp').value,
            actionType: document.getElementById('cond_target_action').value,
            params: {}
        }
    };
    const targetActionSelect = document.getElementById('cond_target_action');
    if (!rule.source.componentId || !rule.target.componentId || !targetActionSelect || targetActionSelect.disabled || !rule.target.actionType) {
        return;
    }

    const targetComponent = network.components.find(c => c.id === rule.target.componentId);
    if (!targetComponent) return;
    const allowedActions = getConditionalActionsForType(targetComponent.type);
    if (!allowedActions.includes(rule.target.actionType)) {
        alert('Selected action is not compatible with the chosen component.');
        return;
    }

    if (rule.target.actionType === 'set_pump_power') {
        rule.target.params.power = document.getElementById('cond_pumpPower').value;
    } else if (rule.target.actionType === 'set_valve_state') {
        rule.target.params.state = document.getElementById('cond_valveState').value;
    } else if (rule.target.actionType === 'set_valve_flow') {
        rule.target.params.flowRate = document.getElementById('cond_valveFlow').value;
    } else if (rule.target.actionType === 'reduce_power' || rule.target.actionType === 'increase_power') {
        rule.target.params.power = document.getElementById('cond_pumpPower').value;
    }
    
    conditionalActions.push(rule);
    updateConditionalActionsTable();
}

function updateConditionalActionsTable() {
    const tableBody = document.getElementById('conditionalActionsTable');
    tableBody.innerHTML = '';
    conditionalActions.forEach((rule, index) => {
        const conditionText = `IF ${rule.source.componentId}'s ${rule.source.value} ${rule.condition.operator} ${rule.condition.threshold}`;
        const actionLabel = CONDITIONAL_ACTION_LABELS[rule.target.actionType] || rule.target.actionType;
        const paramsText = Object.keys(rule.target.params || {}).length ? ` with ${JSON.stringify(rule.target.params)}` : '';
        const actionText = `THEN ${rule.target.componentId} performs ${actionLabel}${paramsText}`;
        const row = tableBody.insertRow();
        row.innerHTML = `<td class="px-6 py-4">${conditionText}</td>
                            <td class="px-6 py-4">${actionText}</td>
                            <td class="px-6 py-4"><button onclick="removeConditionalAction(${index})" class="text-red-500">Remove</button></td>`;
    });
}
function removeConditionalAction(index) { conditionalActions.splice(index, 1); updateConditionalActionsTable(); }


function addAttack(type) {
    let attack = { type };
    if (type === 'chemical_dosing') {
        attack.time = parseInt(document.getElementById('cdTime').value);
        attack.componentId = document.getElementById('cdComponent').value;
        attack.chemicalType = document.getElementById('cdChemicalType').value;
        const amountRaw = document.getElementById('cdAmount').value;
        const parsedAmount = parseFloat(amountRaw);
        attack.amount = isNaN(parsedAmount) ? 1.5 : parsedAmount;
        
        // Validate chemical dosing attack
        if (!attack.time || !attack.componentId || !attack.chemicalType || attack.amount <= 0) {
            alert('Please fill in all fields for the chemical dosing attack: Time, Component, Chemical Type, and Amount > 0.');
            return;
        }
    } else if (type === 'chemical_interference') {
        attack.time = parseInt(document.getElementById('ciTime').value);
        attack.componentId = document.getElementById('ciComponent').value;
        attack.chemical = document.getElementById('ciChemical').value;
        attack.amount = parseFloat(document.getElementById('ciAmount').value);
        
        // Validate chemical interference attack
        if (!attack.time || !attack.componentId || !attack.chemical || isNaN(attack.amount)) {
            alert('Please fill in all fields for the chemical interference attack: Time, Component, Chemical, and Amount.');
            return;
        }
    } else if (type === 'physical_damage') {
        attack.time = parseInt(document.getElementById('pdTime').value);
        attack.componentId = document.getElementById('pdComponent').value;
        attack.damageType = document.getElementById('pdType').value;
        
        // Validate physical damage attack
        if (!attack.time || !attack.componentId || !attack.damageType) {
            alert('Please fill in all fields for the physical damage attack: Time, Component, and Damage Type.');
            return;
        }
    } else if (type === 'data_poisoning') {
        attack.time = parseInt(document.getElementById('dpTime').value);
        attack.duration = parseInt(document.getElementById('dpDuration').value);
        attack.componentId = document.getElementById('dpComponent').value;
        attack.poisonType = document.getElementById('dpSensor').value;
        attack.value = parseFloat(document.getElementById('dpValue').value);
        
        // Validate data poisoning attack
        if (!attack.time || !attack.duration || !attack.componentId || !attack.poisonType || isNaN(attack.value)) {
            alert('Please fill in all fields for the data poisoning attack: Start Time, Duration, Component, Sensor Type, and Value.');
            return;
        }
    }
    if(attack.time !== undefined || attack.startTime !== undefined) {
        attackScenarios.push(attack);
        attackScenarios.sort((a, b) => (a.time || a.startTime) - (b.time || b.startTime));
        updateAttacksTable();
        
        // Clear the form fields after successful addition
        if (type === 'data_poisoning') {
            document.getElementById('dpTime').value = '';
            document.getElementById('dpDuration').value = '';
            document.getElementById('dpComponent').value = '';
            document.getElementById('dpSensor').value = 'waterLevel';
            document.getElementById('dpValue').value = '';
        }
    }
}

function updateAttacksTable() {
    const tableBody = document.getElementById('attacksTable');
    tableBody.innerHTML = '';
    attackScenarios.forEach((attack, index) => {
        const row = tableBody.insertRow();
        let details = '';
        let timeDisplay = '';
        
        switch(attack.type) {
            case 'chemical_dosing': 
                details = `Type: ${attack.chemicalType}, Amount: ${attack.amount}`; 
                timeDisplay = `${attack.time || attack.startTime}`;
                break;
            case 'chemical_interference': 
                details = `Chemical: ${attack.chemical}, Amount: ${attack.amount}`; 
                timeDisplay = `${attack.time || attack.startTime}`;
                break;
            case 'physical_damage': 
                details = `Damage: ${attack.damageType}`; 
                timeDisplay = `${attack.time || attack.startTime}`;
                break;
            case 'data_poisoning': 
                details = `Poison: ${attack.poisonType}, Value: ${attack.value}, Duration: ${attack.duration}s`; 
                const startTime = attack.time || attack.startTime;
                const endTime = startTime + attack.duration;
                timeDisplay = `[${startTime}, ${endTime}]`;
                break;
        }
        row.innerHTML = `<td class="px-6 py-4">${timeDisplay}</td><td class="px-6 py-4">${attack.type}</td>
                            <td class="px-6 py-4">${attack.componentId}</td><td class="px-6 py-4">${details}</td>
                            <td class="px-6 py-4"><button onclick="removeAttack(${index})" class="text-red-500">Remove</button></td>`;
    });
}
function removeAttack(index) { attackScenarios.splice(index, 1); updateAttacksTable(); }

// --- Import/Export ---
function saveSystem() {
    const systemNameInput = prompt("Enter a name for this system:", systemName);
    if (!systemNameInput) return; // User cancelled
    
    systemName = systemNameInput;
    document.getElementById('system-name-display').textContent = systemName;
    // console.log('Updated system name display to:', systemName); // Debug log

    const systemData = {
        name: systemName,
        network: network,
        controlActions: controlActions,
        conditionalActions: conditionalActions,
        attackScenarios: attackScenarios,
        simulationSettings: {
            duration: document.getElementById('simDuration').value,
            ambientTemp: document.getElementById('ambientTemp').value
        }
    };
    
    const blob = new Blob([JSON.stringify(systemData, null, 2)], {type: "application/json"});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${systemName.replace(/\s+/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
}

function loadSystemFromFile(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const systemData = JSON.parse(e.target.result);
                loadSystem(systemData);
            } catch (error) { console.error("Error parsing system file:", error); alert('Error parsing system file.'); }
        };
        reader.readAsText(file);
    }
}

function exportAttackScenarios() {
    const data = { controlActions, conditionalActions, attackScenarios };
    const blob = new Blob([JSON.stringify(data, null, 2)], {type: "application/json"});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'scenarios.json';
    a.click();
    URL.revokeObjectURL(a.href);
}
function importAttackScenarios(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                controlActions = data.controlActions || [];
                conditionalActions = data.conditionalActions || [];
                attackScenarios = data.attackScenarios || [];
                updateControlActionsTable();
                updateConditionalActionsTable();
                updateAttacksTable();
            } catch (error) { console.error("Error parsing scenarios file:", error); alert('Error parsing scenarios file.'); }
        };
        reader.readAsText(file);
    }
}

function resetAnalysisTab() {
    document.getElementById('exportResultsBtn').disabled = true;
    document.getElementById('tab-btn-analysis').disabled = true;
    document.getElementById('analysis-prompt').style.display = 'block';
    document.getElementById('analysis-content').style.display = 'none';
    lastSimulationResults = null;
}

// --- Analysis & Visualization ---


function openSelectionModal(componentId) {
    document.getElementById('selectedComponentId').textContent = componentId;
    document.getElementById('selectionModal').style.display = 'block';
}

function closeSelectionModal() {
    document.getElementById('selectionModal').style.display = 'none';
}

function openEditModal() {
    const componentId = document.getElementById('selectedComponentId').textContent;
    const component = network.components.find(c => c.id === componentId);
    if (!component) return;

    document.getElementById('originalComponentId').value = componentId;
    document.getElementById('editComponentId').value = componentId;

    const propsContainer = document.getElementById('editComponentProperties');
    propsContainer.innerHTML = ''; // Clear previous properties

    if (component.type === 'tank') {
        const shape = (component.shape || 'cylindrical').toLowerCase();
        let geometryInputs = '';
        if (shape === 'rectangular') {
            geometryInputs = `
                <div>
                    <label for="edit_width" class="block text-sm font-medium text-gray-700">Width (m)</label>
                    <input type="number" id="edit_width" value="${component.width || 2}" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2" min="0" step="0.1">
                </div>
                <div>
                    <label for="edit_height" class="block text-sm font-medium text-gray-700">Height (m)</label>
                    <input type="number" id="edit_height" value="${component.height || 2}" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2" min="0" step="0.1">
                </div>
            `;
        } else {
            geometryInputs = `
                <div>
                    <label for="edit_radius" class="block text-sm font-medium text-gray-700">Radius (m)</label>
                    <input type="number" id="edit_radius" value="${component.radius || 1}" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2" min="0" step="0.1">
                </div>
            `;
        }
        propsContainer.innerHTML = `
            <div>
                <label for="edit_maxLevel" class="block text-sm font-medium text-gray-700">Max Level (Height)</label>
                <input type="number" id="edit_maxLevel" value="${component.maxLevel || 10}" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2" min="0" step="0.1">
            </div>
            ${geometryInputs}
        `;
    } else if (component.type === 'pump') {
        propsContainer.innerHTML = `
            <div>
                <label for="edit_maxFlowRate" class="block text-sm font-medium text-gray-700">Max Flow Rate (m³/s)</label>
                <input type="number" id="edit_maxFlowRate" value="${component.maxFlowRate || 0.5}" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2">
            </div>
        `;
    }

    document.getElementById('editModal').style.display = 'block';
    closeSelectionModal();
}

//don't test this
function closeEditModal() {
    document.getElementById('editModal').style.display = 'none';
}

//don't test this
function saveComponentChanges() {
    const oldId = document.getElementById('originalComponentId').value;
    const newId = document.getElementById('editComponentId').value;

    if (oldId !== newId && network.components.some(c => c.id === newId)) {
        console.error("Component ID already exists!");
        return;
    }

    const component = network.components.find(c => c.id === oldId);
    if (!component) return;

    // Update physical properties
    if (component.type === 'tank') {
        const maxLevelVal = parseFloat(document.getElementById('edit_maxLevel').value);
        if (!Number.isNaN(maxLevelVal)) component.maxLevel = maxLevelVal;
        const shape = (component.shape || 'cylindrical').toLowerCase();
        if (shape === 'rectangular') {
            const widthInput = document.getElementById('edit_width');
            const heightInput = document.getElementById('edit_height');
            const widthVal = widthInput ? parseFloat(widthInput.value) : NaN;
            const heightVal = heightInput ? parseFloat(heightInput.value) : NaN;
            if (!Number.isNaN(widthVal) && widthVal > 0) component.width = widthVal;
            if (!Number.isNaN(heightVal) && heightVal > 0) component.height = heightVal;
        } else {
            const radiusInput = document.getElementById('edit_radius');
            const radiusVal = radiusInput ? parseFloat(radiusInput.value) : NaN;
            if (!Number.isNaN(radiusVal) && radiusVal > 0) component.radius = radiusVal;
        }
        const area = shape === 'rectangular'
            ? Math.max(1e-9, (component.width > 0 ? component.width : 1) * (component.height > 0 ? component.height : 1))
            : Math.max(1e-9, Math.PI * Math.pow(component.radius > 0 ? component.radius : 1, 2));
        if (Number.isFinite(component.waterLevel)) {
            component.waterAmount = Math.max(0, component.waterLevel * area);
        }
    } else if (component.type === 'pump') {
        component.maxFlowRate = parseFloat(document.getElementById('edit_maxFlowRate').value);
    }
    
    // Update ID and all references if it changed
    if (oldId !== newId) {
        component.id = newId;
        network.pipes.forEach(p => {
            if (p.from === oldId) p.from = newId;
            if (p.to === oldId) p.to = newId;
        });
        [...controlActions, ...conditionalActions, ...attackScenarios].forEach(action => {
            if (action.componentId === oldId) action.componentId = newId;
            if (action.source && action.source.componentId === oldId) action.source.componentId = newId;
            if (action.target && action.target.componentId === oldId) action.target.componentId = newId;
        });
    }

    // Refresh everything
    updateVisualization();
    updateAllDropdowns();
    updateInitialConditions();
    updatePipeList();
    updateControlActionsTable();
    updateConditionalActionsTable();
    updateAttacksTable();
    resetAnalysisTab();
    closeEditModal();
}

//don't test this

function openEditTimedActionModal(index) {
    const action = controlActions[index];
    if (!action) return;

    document.getElementById('editControlActionIndex').value = index;
    document.getElementById('editControlTime').value = action.time;
    document.getElementById('editControlComponent').value = action.componentId;
    handleEditControlComponentChange(action.actionType, action.params);
    document.getElementById('editControlAction').value = action.actionType;
    updateEditControlActionParams(action.actionType, action.params);

    document.getElementById('editTimedActionModal').style.display = 'block';
}

function closeEditTimedActionModal() {
    document.getElementById('editTimedActionModal').style.display = 'none';
}

function updateEditControlActionParams(actionType, params = {}) {
    const paramsDiv = document.getElementById('editControlActionParams');
    const actionSelect = document.getElementById('editControlAction');
    const effectiveAction = actionType || (actionSelect ? actionSelect.value : '');
    if (!actionSelect || actionSelect.disabled || !effectiveAction) {
        paramsDiv.innerHTML = '';
        return;
    }
    actionType = effectiveAction;
    params = params || {};

    if (actionType === 'set_pump_power') {
        paramsDiv.innerHTML = `<label for="edit_pumpPower" class="block text-sm font-medium text-gray-700">Power (%)</label>
                                <input type="number" id="edit_pumpPower" value="${params.power || 100}" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2" min="0" max="100">`;
    } else if (actionType === 'set_valve_state') {
        paramsDiv.innerHTML = `<label for="edit_valveState" class="block text-sm font-medium text-gray-700">State</label>
                                <select id="edit_valveState" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2">
                                    <option value="open" ${params.state === 'open' ? 'selected' : ''}>Open</option>
                                    <option value="closed" ${params.state === 'closed' ? 'selected' : ''}>Closed</option>
                                </select>`;
    } else if (actionType === 'set_valve_flow') {
        paramsDiv.innerHTML = `<label for="edit_valveFlow" class="block text-sm font-medium text-gray-700">Flow Rate (m³/s)</label>
                                <input type="number" id="edit_valveFlow" value="${params.flowRate || 1.0}" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2" min="0" step="0.1">`;
    }
}

//don't test this

function saveTimedActionChanges() {
    const index = document.getElementById('editControlActionIndex').value;
    if (index === '' || !controlActions[index]) return;

    const actionType = document.getElementById('editControlAction').value;
    const componentId = document.getElementById('editControlComponent').value;
    const component = network.components.find(c => c.id === componentId);
    if (!component) return;
    const allowedActions = getTimedActionsForType(component.type);
    if (!allowedActions.includes(actionType)) {
        alert('Selected action is not compatible with the chosen component.');
        return;
    }
    let params = {};
    if (actionType === 'set_pump_power') {
        params.power = document.getElementById('edit_pumpPower').value;
    } else if (actionType === 'set_valve_state') {
        params.state = document.getElementById('edit_valveState').value;
    } else if (actionType === 'set_valve_flow') {
        params.flowRate = document.getElementById('edit_valveFlow').value;
    }

    controlActions[index] = {
        time: parseInt(document.getElementById('editControlTime').value),
        componentId,
        actionType: actionType,
        params: params
    };

    controlActions.sort((a, b) => a.time - b.time);
    updateControlActionsTable();
    closeEditTimedActionModal();
}

//don't test this

function renderAnalysisCharts() {
    const componentId = document.getElementById('analysisComponent').value;
    if (!componentId || !lastSimulationResults) return;

    activeCharts.forEach(chart => chart.destroy());
    activeCharts = [];

    const chartsContainer = document.getElementById('charts-container');
    chartsContainer.innerHTML = '';

    const timeData = lastSimulationResults.map(d => d.time);
    const parameters = ['waterLevel', 'waterAmount', 'power', 'temperature', 'ph', 'o2', 'bodn', 'nitrate', 'co2'];
    const units = {
        waterLevel: '(m)',
        waterAmount: '(m³)',
        power: '(%)',
        temperature: '(°C)',
        ph: '(pH)',
        o2: '(mg/L)',
        bodn: '(mg/L)',
        nitrate: '(mg/L)',
        co2: '(mg/L)'
    };
    
    const annotations = {};

    attackScenarios.forEach((attack, i) => {
        const attackTime = attack.time !== undefined ? attack.time : attack.startTime;
        const attackLabel = `${attack.type} on ${attack.componentId}`;
        
        // Check if attack has duration (data poisoning, DDoS, etc.)
        if (attack.duration && attack.duration > 0) {
            annotations[`attack_box_${i}`] = {
                type: 'box', 
                xMin: attackTime, 
                xMax: attackTime + attack.duration,
                backgroundColor: 'rgba(255, 99, 132, 0.15)', 
                borderColor: 'rgba(255, 99, 132, 1)', 
                borderWidth: 1,
                label: { 
                    content: `${attackLabel} (${attack.duration}s)`, 
                    display: true, 
                    position: 'start',
                    backgroundColor: 'rgba(255, 99, 132, 0.9)',
                    color: 'white',
                    font: { size: 10 }
                }
            };
        } else {
            // Instant attacks (chemical dosing, physical damage, etc.)
            annotations[`attack_line_${i}`] = {
                type: 'line', 
                xMin: attackTime, 
                xMax: attackTime,
                borderColor: 'rgb(255, 99, 132)', 
                borderWidth: 2,
                label: { 
                    content: attackLabel, 
                    display: true, 
                    position: 'start', 
                    backgroundColor: 'rgba(255, 99, 132, 0.8)', 
                    color: 'white' 
                }
            };
        }
    });

    controlActions.filter(a => a.componentId === componentId).forEach((action, i) => {
        let label = '';
        if(action.actionType === 'set_pump_power') label = `Pump Power: ${action.params.power}%`;
        if(action.actionType === 'set_valve_state') label = `Valve: ${action.params.state}`;
        if(action.actionType === 'set_valve_flow') label = `Valve Flow: ${action.params.flowRate} m³/s`;

        annotations[`control_${i}`] = {
            type: 'line', xMin: action.time, xMax: action.time,
            borderColor: 'rgb(75, 192, 192)', borderDash: [6, 6], borderWidth: 2,
            label: { content: label, display: true, position: 'end', backgroundColor: 'rgba(75, 192, 192, 0.8)', color: 'white' }
        };
    });


    parameters.forEach(param => {
        const comp = network.components.find(c => c.id === componentId);
        const dataKey = `${componentId}_${param}`;

        if (!lastSimulationResults[0].hasOwnProperty(dataKey)) return;

        const chartData = lastSimulationResults.map(d => d[dataKey]);
        
        const canvasContainer = document.createElement('div');
        canvasContainer.className = 'bg-gray-50 p-4 rounded-lg';
        const canvas = document.createElement('canvas');
        canvasContainer.appendChild(canvas);
        chartsContainer.appendChild(canvasContainer);

        const newChart = new Chart(canvas, {
            type: 'line',
            data: {
                labels: timeData,
                datasets: [{
                    label: `${componentId} - ${param}`,
                    data: chartData,
                    borderColor: 'rgb(59, 130, 246)',
                    tension: 0.1,
                    pointRadius: 0
                }]
            },
            options: {
                scales: { 
                    x: { title: { display: true, text: 'Time (s)' } },
                    y: { title: { display: true, text: `${param.charAt(0).toUpperCase() + param.slice(1)} ${units[param] || ''}` } }
                },
                plugins: {
                    title: { display: true, text: `${param.charAt(0).toUpperCase() + param.slice(1)} Over Time` },
                    annotation: { annotations: annotations }
                }
            }
        });
        activeCharts.push(newChart);
    });
}

// --- Simulation Engine ---
function startSimulation() {
    console.log("Starting simulation...");
    const duration = parseInt(document.getElementById('simDuration').value);
    const ambientTemp = parseFloat(document.getElementById('ambientTemp').value);
    const timeStep = 1;

    document.querySelectorAll('#initial-conditions-container [data-param]').forEach(field => {
        const comp = network.components.find(c => c.id === field.dataset.id);
        if (!comp) return;
        const param = field.dataset.param;
        const type = field.dataset.type || (field.tagName === 'SELECT' ? 'text' : 'number');
        let value;
        if (type === 'boolean') {
            value = field.value === 'true';
        } else if (type === 'number') {
            const parsed = parseFloat(field.value);
            if (Number.isNaN(parsed)) return;
            value = parsed;
        } else {
            value = field.value;
        }
        comp[param] = value;
    });

    network.components.forEach(comp => {
        if (comp.type === 'pump') {
            comp.power = Math.max(0, Math.min(100, Number.isFinite(comp.power) ? comp.power : 0));
        }
        if (comp.type === 'valve') {
            comp.isOpen = comp.isOpen !== false;
            if (!Number.isFinite(comp.flowRate)) comp.flowRate = 0;
            if (!comp.isOpen) comp.flowRate = 0;
        }
        if (comp.type === 'tank') {
            const shape = (comp.shape || 'cylindrical').toLowerCase();
            let area;
            if (shape === 'rectangular') {
                const width = Number.isFinite(comp.width) && comp.width > 0 ? comp.width : 1;
                const depth = Number.isFinite(comp.height) && comp.height > 0 ? comp.height : 1;
                area = width * depth;
                comp.width = width;
                comp.height = depth;
            } else {
                const radius = Number.isFinite(comp.radius) && comp.radius > 0 ? comp.radius : 1;
                area = Math.PI * Math.pow(radius, 2);
                comp.radius = radius;
            }
            if (Number.isFinite(area) && area > 0 && Number.isFinite(comp.waterLevel)) {
                comp.waterAmount = Math.max(0, comp.waterLevel * area);
            }
        }
    });

    const progressBar = document.getElementById('progress-bar');
    const progressContainer = document.getElementById('simulation-progress');
    progressContainer.style.display = 'block';

    // Use the tested ACWA Engine instead of inline simulation
    const state = {
        network: network,
        controlActions: controlActions,
        conditionalActions: conditionalActions,
        attackScenarios: attackScenarios
    };
    
    const settings = {
        duration: duration,
        ambientTemp: ambientTemp,
        timeStep: timeStep
    };

    // Run the simulation using the engine
    console.log("Using ACWA Engine for simulation with", state.network.components.length, "components");
    const engineResult = ACWAEngine.startSimulationPure(state, settings);
    const simulationData = engineResult.results;
    console.log("Engine completed simulation with", simulationData.length, "time steps");

    // Update progress bar
    progressBar.style.width = '100%';

    console.log("Simulation finished.");
    progressContainer.style.display = 'none';
    progressBar.style.width = '0%';
    
    lastSimulationResults = simulationData;
    document.getElementById('tab-btn-analysis').disabled = false;
    document.getElementById('analysis-prompt').style.display = 'none';
    document.getElementById('analysis-content').style.display = 'block';
    document.getElementById('exportResultsBtn').disabled = false;
    updateAllDropdowns();
    renderAnalysisCharts();
    setActiveTab('analysis');
}

//don't test this
async function exportNetworkAsPNG() {
    try {
        const content = document.getElementById('network-visualizer-content');
        if (!content) return;

        // Compute full bounds of all visual elements within the content
        const contentRect = content.getBoundingClientRect();
        const elements = content.querySelectorAll('.component-node, .pipe-line, .pipe-arrow');
        if (!elements || elements.length === 0) return;

        let minLeft = Infinity, minTop = Infinity, maxRight = -Infinity, maxBottom = -Infinity;
        elements.forEach(el => {
            const r = el.getBoundingClientRect();
            const left = r.left - contentRect.left;
            const top = r.top - contentRect.top;
            const right = left + r.width;
            const bottom = top + r.height;
            if (left < minLeft) minLeft = left;
            if (top < minTop) minTop = top;
            if (right > maxRight) maxRight = right;
            if (bottom > maxBottom) maxBottom = bottom;
        });

        const padding = 20;
        const exportWidth = Math.ceil(maxRight - minLeft) + padding * 2;
        const exportHeight = Math.ceil(maxBottom - minTop) + padding * 2;

        // Create an offscreen clone to avoid UI jumps
        const offscreen = document.createElement('div');
        offscreen.style.position = 'fixed';
        offscreen.style.left = '-100000px';
        offscreen.style.top = '0';
        offscreen.style.width = exportWidth + 'px';
        offscreen.style.height = exportHeight + 'px';
        offscreen.style.backgroundColor = '#f3f4f6';

        const clone = content.cloneNode(true);
        clone.id = 'network-visualizer-content-export-clone';
        clone.style.minWidth = 'unset';
        clone.style.minHeight = 'unset';
        clone.style.width = exportWidth + 'px';
        clone.style.height = exportHeight + 'px';
        clone.style.transform = `translate(${-Math.floor(minLeft) + padding}px, ${-Math.floor(minTop) + padding}px)`;

        offscreen.appendChild(clone);
        document.body.appendChild(offscreen);

        // Wait a frame for layout
        await new Promise(resolve => requestAnimationFrame(resolve));

        const canvas = await html2canvas(offscreen, {
            backgroundColor: '#f3f4f6',
            useCORS: true,
            scale: Math.max(2, Math.round(2 / Math.max(currentZoom, 0.1))),
            width: exportWidth,
            height: exportHeight
        });

        // Clean up the temporary DOM
        document.body.removeChild(offscreen);

        const dataURL = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = dataURL;
        a.download = `network_${new Date().toISOString().replace(/:/g, '-')}.png`;
        a.click();
    } catch (e) {
        console.error('Failed to export network PNG', e);
    }
}

//don't test this
function exportResults() {
    if (!lastSimulationResults || lastSimulationResults.length === 0) {
        console.error("No simulation data to export.");
        return;
    }
    const fieldSet = new Set();
    lastSimulationResults.forEach(row => {
        Object.keys(row).forEach(key => fieldSet.add(key));
    });
    const allFields = Array.from(fieldSet);
    const orderedFields = [];
    if (fieldSet.has('time')) orderedFields.push('time');
    if (fieldSet.has('active_attacks')) orderedFields.push('active_attacks');
    allFields.forEach(field => {
        if (!orderedFields.includes(field)) orderedFields.push(field);
    });
    const csv = Papa.unparse(lastSimulationResults, { columns: orderedFields });
    const blob = new Blob([csv], {type: "text/csv;charset=utf-8;"});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `simulation_results_${new Date().toISOString().replace(/:/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
}
