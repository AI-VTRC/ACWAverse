// Data management: examples, opening and saving scenarios, exporting tables.

export const EXAMPLES = [
  { file: 'muleshoe.json', title: 'Muleshoe water system' },
  { file: 'pumped-tower.json', title: 'Pump, tower and town' },
  { file: 'four-tank-timed.json', title: 'Four-tank loop, timed' },
  { file: 'four-tank-conditional.json', title: 'Four-tank loop, conditional' },
  { file: 'acwa-line.json', title: 'ACWA testbed, line' },
  { file: 'acwa-bus.json', title: 'ACWA testbed, bus' },
  { file: 'acwa-star.json', title: 'ACWA testbed, star' }
];

/** Load an example scenario: built into the page if it is self-contained, fetched otherwise. */
export async function loadExample(file) {
  const bundled = globalThis.ACWAVERSE_EXAMPLES;
  if (bundled && bundled[file]) return JSON.parse(JSON.stringify(bundled[file]));
  const response = await fetch(`examples/${file}`);
  if (!response.ok) throw new Error(`Could not load ${file} (${response.status}).`);
  return response.json();
}

/** Read a scenario from a file the user picked. */
export function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The file could not be read.'));
    reader.onload = () => {
      try {
        const scenario = JSON.parse(String(reader.result));
        if (!scenario || !Array.isArray(scenario.nodes) || !Array.isArray(scenario.links)) throw new Error('This is not an ACWAverse scenario: it has no nodes and links.');
        scenario.sensors = scenario.sensors || [];
        scenario.controllers = scenario.controllers || [];
        scenario.attacks = scenario.attacks || [];
        resolve(scenario);
      } catch (error) {
        reject(error instanceof SyntaxError ? new Error('The file is not valid JSON.') : error);
      }
    };
    reader.readAsText(file);
  });
}

export function scenarioText(scenario) {
  return JSON.stringify({ format: 'acwaverse/2', ...scenario }, null, 2) + '\n';
}

export function fileName(name, extension) {
  const slug = String(name || 'scenario').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'scenario';
  return `${slug}.${extension}`;
}

/** Offer text as a file to save. Returns false where the browser does not allow it. */
export function saveText(name, text, type) {
  try {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return true;
  } catch {
    return false;
  }
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
