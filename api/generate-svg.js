export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'API key not configured. Set ANTHROPIC_API_KEY in environment variables.',
    });
  }

  const { imageBase64, analysisMetadata, model } = req.body || {};

  if (!imageBase64 || !analysisMetadata) {
    return res.status(400).json({ error: 'Missing imageBase64 or analysisMetadata' });
  }

  const selectedModel =
    model === 'haiku' ? 'claude-haiku-4-5-20251001' : 'claude-sonnet-4-20250514';

  const {
    width,
    height,
    hasHorizon,
    horizonY,
    hasReflection,
    centroids,
    sceneAvgColor,
    regionBounds,
  } = analysisMetadata;

  // Format centroids as a readable list
  const centroidsFormatted = Array.isArray(centroids)
    ? centroids.map((c, i) => `  ${i + 1}. rgb(${c.join(', ')})`).join('\n')
    : 'none provided';

  // Format region bounds keys
  const regionKeys = regionBounds
    ? Object.keys(regionBounds).join(', ')
    : 'none';

  // Format scene average color
  const avgColorStr = Array.isArray(sceneAvgColor)
    ? sceneAvgColor.join(', ')
    : sceneAvgColor || 'unknown';

  const horizonInfo = hasHorizon
    ? `detected at Y=${horizonY} (${Math.round((horizonY / height) * 100)}% from top)`
    : 'not detected';

  const reflectionInfo = hasReflection
    ? 'detected (mirror symmetry across horizon)'
    : 'not detected';

  const systemPrompt = `You are an expert watercolor composition designer and SVG engineer. You will receive a photograph and analysis metadata. Your task is to create a deterministic, scene-specific SVG composition that deconstructs the photograph into paintable layers.

STUDY THE PHOTOGRAPH CAREFULLY. Identify specific elements: buildings (with windows, doors, signage), poles, wires, trees, clouds (their actual shapes), textures, birds, vehicles, people silhouettes, water reflections — everything that makes THIS scene unique.

You MUST respond with ONLY a valid JSON object. No markdown code fences. No explanation before or after. Just the JSON.

Schema:
{
  "viewBox": "0 0 WIDTH HEIGHT",
  "layers": [
    {
      "id": "kebab-case-unique-id",
      "name": "Human Readable Name",
      "description": "What this layer represents and how it was derived",
      "paintingTip": "Specific watercolor technique advice for this layer",
      "elements": [
        {
          "type": "rect" | "circle" | "ellipse" | "path" | "line" | "defs",
          "attrs": { SVG attributes as camelCase key-value pairs }
        }
      ]
    }
  ]
}

RULES:
1. ViewBox: Use the dimensions from analysisMetadata, scaled so longest edge is ~800px. Match the image aspect ratio exactly.
2. Colors: Use ONLY hex colors derived from the provided centroids array or sampled from the actual image. Never invent colors.
3. Horizon: If hasHorizon is true, place the horizon line at the correct Y position (horizonY scaled to viewBox). Architectural elements must align with this line.
4. Layers: Create 5-8 layers, ordered back-to-front (background washes first, fine details last). Each layer corresponds to a watercolor painting step.
5. Scene specificity: Include the ACTUAL elements you see in the photo. If there are buildings, draw their specific shapes with windows and structural details. If there's a light pole, draw it. If there are birds, include them. Generic blobs are not acceptable.
6. Reflections: If hasReflection is true, create reflected versions of above-horizon elements below the horizon. Compress reflected shapes vertically by 0.85x and darken colors by ~20%.
7. Gradients: Put gradient definitions in a "defs" element with the SVG markup in its "content" field. Reference via url(#gradientId) in fill/stroke attrs.
8. Texture: For concrete, asphalt, or rough surfaces, use path elements with strokeDasharray patterns to simulate dry brush texture.
9. All SVG attributes must be camelCase: strokeWidth (not stroke-width), strokeDasharray (not stroke-dasharray), fillOpacity (not fill-opacity).
10. Painting tips should be specific and beginner-friendly: mention brush type, technique (wet-on-wet, dry brush), and which pigments to mix.`;

  const userPrompt = `Analyze this photograph and create a detailed SVG composition for watercolor painting.

Analysis metadata:
- Dimensions: ${width} x ${height} pixels
- Horizon: ${horizonInfo}
- Reflection: ${reflectionInfo}
- Dominant colors (RGB):
${centroidsFormatted}
- Scene average color: rgb(${avgColorStr})
- Regions detected: ${regionKeys}

Study the image carefully. Identify every specific architectural element, natural feature, and detail. Create a layered SVG composition that captures the unique character of THIS scene — not a generic interpretation.`;

  const requestBody = {
    model: selectedModel,
    max_tokens: 8192,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/jpeg',
              data: imageBase64,
            },
          },
          {
            type: 'text',
            text: userPrompt,
          },
        ],
      },
    ],
  };

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return res.status(502).json({
        error: 'AI generation failed',
        detail: errorBody,
      });
    }

    const data = await response.json();

    // Extract text content from the response
    const textBlock = data.content?.find((block) => block.type === 'text');
    if (!textBlock || !textBlock.text) {
      return res.status(502).json({ error: 'Invalid response from AI' });
    }

    let rawText = textBlock.text.trim();

    // Attempt to parse JSON directly
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      // Strip markdown code fences if present
      const fenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) {
        rawText = fenceMatch[1].trim();
      }
      try {
        parsed = JSON.parse(rawText);
      } catch {
        return res.status(502).json({ error: 'Invalid response from AI' });
      }
    }

    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(502).json({
      error: 'AI generation failed',
      detail: err.message,
    });
  }
}
