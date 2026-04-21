// Deterministic markdown sample generator for the editor harness.
//
// We want reproducible content across reloads and across editor backends so
// perf comparisons are apples-to-apples. A seeded PRNG (mulberry32) drives
// paragraph length, list length, and block-type selection; the same size
// bucket always produces the same document bytes.

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = [
  'atom', 'graph', 'tag', 'embedding', 'vector', 'semantic', 'reader', 'wiki',
  'canvas', 'chat', 'agent', 'retrieval', 'chunk', 'similarity', 'index', 'query',
  'markdown', 'editor', 'virtualize', 'viewport', 'render', 'prose', 'block',
  'paragraph', 'heading', 'fence', 'list', 'quote', 'link', 'image', 'table',
  'pipeline', 'transport', 'facade', 'store', 'subscribe', 'callback', 'payload',
  'hydrate', 'serialize', 'diff', 'cursor', 'selection', 'decoration', 'widget',
  'syntax', 'parser', 'tree', 'token', 'highlight', 'theme', 'dark', 'panel',
];

const CODE_SAMPLES = [
  {
    lang: 'typescript',
    body:
      'export function chunkMarkdown(input: string): string[] {\n' +
      '  const blocks: string[] = [];\n' +
      '  let cursor = 0;\n' +
      '  while (cursor < input.length) {\n' +
      '    const next = input.indexOf("\\n\\n", cursor);\n' +
      '    if (next === -1) { blocks.push(input.slice(cursor)); break; }\n' +
      '    blocks.push(input.slice(cursor, next));\n' +
      '    cursor = next + 2;\n' +
      '  }\n' +
      '  return blocks;\n' +
      '}',
  },
  {
    lang: 'rust',
    body:
      'pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {\n' +
      '    let dot: f32 = a.iter().zip(b).map(|(x, y)| x * y).sum();\n' +
      '    let na: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();\n' +
      '    let nb: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();\n' +
      '    dot / (na * nb)\n' +
      '}',
  },
  {
    lang: 'python',
    body:
      'def embed_batch(texts: list[str]) -> list[list[float]]:\n' +
      '    response = client.embeddings.create(model="text-embedding-3-large", input=texts)\n' +
      '    return [r.embedding for r in response.data]',
  },
];

function words(rng: () => number, count: number): string {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(WORDS[Math.floor(rng() * WORDS.length)]);
  }
  out[0] = out[0][0].toUpperCase() + out[0].slice(1);
  return out.join(' ');
}

function paragraph(rng: () => number): string {
  const sentenceCount = 3 + Math.floor(rng() * 4);
  const sentences: string[] = [];
  for (let i = 0; i < sentenceCount; i++) {
    const len = 8 + Math.floor(rng() * 14);
    sentences.push(words(rng, len) + '.');
  }
  return sentences.join(' ');
}

function list(rng: () => number): string {
  const n = 3 + Math.floor(rng() * 5);
  const items: string[] = [];
  for (let i = 0; i < n; i++) {
    items.push('- ' + words(rng, 4 + Math.floor(rng() * 10)) + '.');
  }
  return items.join('\n');
}

function codeBlock(rng: () => number): string {
  const sample = CODE_SAMPLES[Math.floor(rng() * CODE_SAMPLES.length)];
  return '```' + sample.lang + '\n' + sample.body + '\n```';
}

function quote(rng: () => number): string {
  return '> ' + words(rng, 14 + Math.floor(rng() * 20)) + '.';
}

function link(rng: () => number): string {
  return (
    words(rng, 6) +
    ' — see [' +
    words(rng, 3) +
    '](https://example.org/' +
    Math.floor(rng() * 100000).toString(16) +
    ') for more.'
  );
}

// Generate a section: h2 + 3-6 blocks.
function section(rng: () => number, idx: number): string {
  const title = words(rng, 3 + Math.floor(rng() * 4));
  const parts: string[] = [`## ${idx}. ${title}`];
  const blockCount = 3 + Math.floor(rng() * 4);
  for (let i = 0; i < blockCount; i++) {
    const pick = rng();
    if (pick < 0.55) parts.push(paragraph(rng));
    else if (pick < 0.75) parts.push(list(rng));
    else if (pick < 0.88) parts.push(codeBlock(rng));
    else if (pick < 0.95) parts.push(quote(rng));
    else parts.push(link(rng));
  }
  return parts.join('\n\n');
}

export type SampleSize = '1 page' | '10 pages' | '100 pages' | '500 pages' | '1000 pages';

const SECTIONS_PER_SIZE: Record<SampleSize, number> = {
  '1 page': 1,
  '10 pages': 10,
  '100 pages': 100,
  '500 pages': 500,
  '1000 pages': 1000,
};

export const SAMPLE_SIZES: SampleSize[] = [
  '1 page',
  '10 pages',
  '100 pages',
  '500 pages',
  '1000 pages',
];

// Cache so flipping between sizes doesn't re-pay the generation cost.
const cache = new Map<SampleSize, string>();

export function generateSampleMarkdown(size: SampleSize): string {
  const cached = cache.get(size);
  if (cached) return cached;

  const rng = mulberry32(0xa70c1c ^ SECTIONS_PER_SIZE[size]);
  const sections: string[] = [
    `# Editor harness — ${size}`,
    `_A deterministic markdown sample used to stress-test the Atomic editor at scale. Seed: \`0xa70c1c ⊕ ${SECTIONS_PER_SIZE[size]}\`_`,
  ];
  for (let i = 1; i <= SECTIONS_PER_SIZE[size]; i++) {
    sections.push(section(rng, i));
  }
  const doc = sections.join('\n\n') + '\n';
  cache.set(size, doc);
  return doc;
}
