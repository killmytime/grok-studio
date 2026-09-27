import generateTemplate from './workflows/qwen-image.json';
import editTemplate from './workflows/qwen-image-edit.json';

export type ComfyNode = {
  class_type: string;
  inputs: Record<string, unknown>;
  _meta?: { title?: string };
};

export type ComfyGraph = Record<string, ComfyNode>;

export const DEFAULT_NEGATIVE = 'low quality, bad anatomy, extra digits, missing digits, extra limbs, missing limbs';

const GENERATE_TEMPLATE = generateTemplate as unknown as ComfyGraph;
const EDIT_TEMPLATE = editTemplate as unknown as ComfyGraph;

export interface PreparedWorkflow {
  graph: ComfyGraph;
  negative: string;
  seed: number;
  steps: number;
  width: number;
  height: number;
}

function cloneGraph(graph: ComfyGraph): ComfyGraph {
  return JSON.parse(JSON.stringify(graph)) as ComfyGraph;
}

function idsByClass(graph: ComfyGraph, classType: string): string[] {
  return Object.entries(graph).filter(([, node]) => node.class_type === classType).map(([id]) => id);
}

function linkId(value: unknown): string | null {
  if (Array.isArray(value) && value.length >= 1 && value[0] != null) return String(value[0]);
  return null;
}

function writePositive(node: ComfyNode, text: string) {
  if (node.class_type === 'TextEncodeQwenImage21') node.inputs.prompt = text;
  else node.inputs.text = text;
}

function writeNegative(node: ComfyNode, text: string) {
  if (node.class_type === 'TextEncodeQwenImage21') node.inputs.negative_prompt = text;
  else node.inputs.text = text;
}

function readNegative(node: ComfyNode | undefined): string {
  if (!node) return '';
  if (node.class_type === 'TextEncodeQwenImage21') return String(node.inputs.negative_prompt || '');
  return String(node.inputs.text || '');
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}

function applyCommon(graph: ComfyGraph, opts: {
  positive: string;
  negative?: string | null;
  seed?: number;
  steps?: number;
  unetName?: string;
}): { seed: number; steps: number; negative: string } {
  const positive = opts.positive.trim();
  if (!positive) throw new Error('正向提示词必填');

  if (opts.unetName) {
    for (const id of idsByClass(graph, 'UNETLoader')) {
      graph[id].inputs.unet_name = opts.unetName;
    }
  }

  const samplers = idsByClass(graph, 'KSampler');
  if (samplers.length === 0) throw new Error('工作流里没有 KSampler');

  let seed = opts.seed ?? randomSeed();
  let steps = 20;
  let negative = '';
  for (const id of samplers) {
    const node = graph[id];
    node.inputs.seed = seed;
    seed = Number(node.inputs.seed) || 0;
    if (opts.steps != null && opts.steps > 0) node.inputs.steps = opts.steps;
    steps = Number(node.inputs.steps) || steps;

    const pos = linkId(node.inputs.positive);
    const neg = linkId(node.inputs.negative);
    if (!pos || !graph[pos]) throw new Error('工作流的正向条件没有接到采样器');
    writePositive(graph[pos], positive);
    if (neg && graph[neg] && opts.negative && opts.negative.trim()) {
      writeNegative(graph[neg], opts.negative.trim());
    }
    if (neg && graph[neg]) negative = readNegative(graph[neg]);
  }
  return { seed, steps, negative: negative || DEFAULT_NEGATIVE };
}

export function prepareGenerateWorkflow(opts: {
  positive: string;
  negative?: string | null;
  width: number;
  height: number;
  batch: number;
  seed?: number;
  steps?: number;
  unetName?: string;
}): PreparedWorkflow {
  const graph = cloneGraph(GENERATE_TEMPLATE);
  const common = applyCommon(graph, opts);
  const latents = idsByClass(graph, 'EmptySD3LatentImage');
  if (latents.length === 0) throw new Error('生图工作流里没有空 Latent');
  for (const id of latents) {
    graph[id].inputs.width = opts.width;
    graph[id].inputs.height = opts.height;
    graph[id].inputs.batch_size = opts.batch;
  }
  return { graph, ...common, width: opts.width, height: opts.height };
}

export function prepareEditWorkflow(opts: {
  positive: string;
  negative?: string | null;
  imageName: string;
  resolution: number;
  seed?: number;
  steps?: number;
  unetName?: string;
}): PreparedWorkflow {
  const graph = cloneGraph(EDIT_TEMPLATE);
  const common = applyCommon(graph, opts);
  const loaders = idsByClass(graph, 'LoadImage');
  if (loaders.length === 0) throw new Error('改图工作流里没有加载图像');
  for (const id of loaders) graph[id].inputs.image = opts.imageName;

  const encoders = idsByClass(graph, 'TextEncodeQwenImage21');
  if (encoders.length === 0) throw new Error('改图工作流里没有 Qwen Image 2.1 文本编码');
  for (const id of encoders) {
    graph[id].inputs.prompt = opts.positive.trim();
    graph[id].inputs.resolution = opts.resolution;
    if (opts.negative && opts.negative.trim()) graph[id].inputs.negative_prompt = opts.negative.trim();
  }
  return { graph, ...common, width: opts.resolution, height: opts.resolution };
}

/** Redraw from the source pixels. The reference encoder keeps whatever is already in the picture, so new clothes or objects need this path. */
export function prepareRedrawWorkflow(opts: {
  positive: string;
  negative?: string | null;
  imageName: string;
  denoise: number;
  seed?: number;
  steps?: number;
  unetName?: string;
}): PreparedWorkflow {
  const graph = cloneGraph(GENERATE_TEMPLATE);
  const vaeIds = idsByClass(graph, 'VAELoader');
  if (vaeIds.length === 0) throw new Error('生图工作流里没有 VAE');
  graph['80'] = {
    class_type: 'LoadImage',
    inputs: { image: opts.imageName },
  };
  graph['82'] = {
    class_type: 'VAEEncode',
    inputs: { pixels: ['80', 0], vae: [vaeIds[0], 0] },
  };
  const common = applyCommon(graph, opts);
  for (const id of idsByClass(graph, 'KSampler')) {
    graph[id].inputs.latent_image = ['82', 0];
    graph[id].inputs.denoise = opts.denoise;
  }
  return { graph, ...common, width: 0, height: 0 };
}
