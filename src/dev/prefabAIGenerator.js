import { DEFAULT_TEXTURE_ATLAS } from './textureAtlasRegistry.js';
import { normalizePrefab, normalizePrefabPrimitive } from './prefabRegistry.js';
import { capGeneratedScale, fitGeneratedPrefabToEditorSpace } from './prefabGeneration.js';
import { safeParseJson } from './editorShared.js';

export async function generatePrefabFromPrompt({ prompt, apiKey, textureAtlases }) {
  const atlasIds = (textureAtlases ?? []).map((atlas) => atlas.id).join(', ');
  const systemPrompt = [
    'You are generating prefab geometry for a 3D kitchen game.',
    'Return JSON only. No markdown, no commentary, no code fences.',
    'The JSON must match this shape:',
    '{ name: string, size: { x: number, y: number, z: number }, primitives: Array<primitive> }',
    'Default to a 1x1 prefab size in metadata and express footprint only through primitive scale.',
    'The prefab editor volume should read like a 2x2 base footprint with a square silhouette.',
    'The total prefab can be up to 4 units tall.',
    'Keep each primitive height at or below 2.',
    'Prefer a composition of two stacked 2x2x2-ish masses inside that volume instead of one square column.',
    'Do not collapse the object into a single square fridge-like block unless the prompt explicitly asks for a monolith.',
    'Use a stable, blocky silhouette. Do not make thin poles, long spires, or giant flat panels unless the prompt clearly asks for them.',
    'Each primitive must use only these fields:',
    '{ id, name, type, position:{x,y,z}, rotation:{x,y,z}, scale:{x,y,z}, texture:{atlas,cell,repeat:{x,y},rotation}, material:{color,roughness,metalness}, collider, castShadow, receiveShadow }',
    'Allowed primitive types: box, plane, cylinder, wedge.',
    'Keep the object simple, compact, and valid for a 1x1 or small multi-cell prefab.',
    'Use the smallest sensible number of primitives. Favor boxes and cylinders.',
    `Available texture atlases: ${atlasIds}. Use atlas ids only if texture assignment is helpful.`,
    'Do not include duplicate parts, negative scales, or huge coordinates.',
    'The user prompt is the desired object, for example "chair".',
  ].join('\n');

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': window.location.origin,
      'X-Title': 'Mouse Trouble Prefab Editor',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_completion_tokens: 4096,
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error?.message || response.statusText || 'OpenRouter request failed');
  }

  const content = payload?.choices?.[0]?.message?.content ?? '';
  const parsed = safeParseJson(content);
  let prefab = normalizePrefab({
    name: parsed.name || prompt,
    size: { x: 1, y: 1, z: 1 },
    primitives: Array.isArray(parsed.primitives) ? parsed.primitives : [],
  });

  prefab.primitives = prefab.primitives.map((primitive) => normalizePrefabPrimitive({
    ...primitive,
    texture: {
      atlas: primitive.texture?.atlas ?? DEFAULT_TEXTURE_ATLAS,
      cell: Number.isFinite(primitive.texture?.cell) ? primitive.texture.cell : 0,
      repeat: primitive.texture?.repeat ?? { x: 1, y: 1 },
      rotation: primitive.texture?.rotation ?? 0,
    },
  }));
  prefab.primitives = prefab.primitives.map((primitive) => normalizePrefabPrimitive({
    ...primitive,
    scale: {
      x: capGeneratedScale(primitive.scale.x ?? 1),
      y: capGeneratedScale(primitive.scale.y ?? 1, 2),
      z: capGeneratedScale(primitive.scale.z ?? 1),
    },
  }));

  return fitGeneratedPrefabToEditorSpace(prefab, { footprint: 2, maxHeight: 2, totalHeight: 4 });
}
