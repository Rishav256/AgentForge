interface StepExecutionResult {
  output: Record<string, any>;
}

function interpolate(template: string, previousOutput: any): string {
  const outputStr =
    typeof previousOutput === 'string'
      ? previousOutput
      : JSON.stringify(previousOutput ?? '');
  return template.replace(/\{\{previousOutput\}\}/g, outputStr);
}

interface LlmCallResult {
  output: Record<string, any>;
}

async function executeLlmCall(
  step: any,
  context: { previousOutput: any },
): Promise<LlmCallResult> {
  const { prompt, model, systemPrompt, temperature } = step.config ?? {};

  if (!prompt) {
    throw new Error('llm_call step is missing required config field: prompt');
  }

  const interpolatedPrompt = interpolate(prompt, context.previousOutput);

  const messages: { role: string; content: string }[] = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: interpolatedPrompt });

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: model ?? 'openai/gpt-oss-20b',
      messages,
      temperature: temperature ?? 0.7,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Groq API error (${res.status}): ${errBody}`);
  }

  const json = await res.json();
  const content = json.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('Groq response missing expected content field');
  }

  return { output: { text: content, model: json.model, usage: json.usage } };
}

interface HttpRequestResult {
  output: Record<string, any>;
}

function interpolateDeep(value: any, previousOutput: any): any {
  if (typeof value === 'string') return interpolate(value, previousOutput);
  if (Array.isArray(value))
    return value.map((v) => interpolateDeep(v, previousOutput));
  if (value && typeof value === 'object') {
    const result: Record<string, any> = {};
    for (const key of Object.keys(value)) {
      result[key] = interpolateDeep(value[key], previousOutput);
    }
    return result;
  }
  return value;
}

async function executeHttpRequest(
  step: any,
  context: { previousOutput: any },
): Promise<HttpRequestResult> {
  const { url, method, headers, body, timeoutMs } = step.config ?? {};

  if (!url) {
    throw new Error('http_request step is missing required config field: url');
  }

  const interpolatedUrl = interpolate(url, context.previousOutput);

  let requestBody: string | undefined;
  if (body !== undefined) {
    const interpolatedBody = interpolateDeep(body, context.previousOutput);
    requestBody =
      typeof interpolatedBody === 'string'
        ? interpolatedBody
        : JSON.stringify(interpolatedBody);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs ?? 10000);

  let res: Response;
  try {
    res = await fetch(interpolatedUrl, {
      method: method ?? 'GET',
      headers: headers ?? {},
      body: requestBody,
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error(`http_request timed out after ${timeoutMs ?? 10000}ms`);
    }
    throw new Error(`http_request failed: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`http_request received ${res.status}: ${errBody}`);
  }

  const contentType = res.headers.get('content-type') ?? '';
  const responseBody = contentType.includes('application/json')
    ? await res.json()
    : await res.text();

  const responseHeaders: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  return {
    output: {
      status: res.status,
      body: responseBody,
      headers: responseHeaders,
    },
  };
}

export async function executeStep(
  step: any,
  context: { previousOutput: any },
): Promise<StepExecutionResult> {
  switch (step.type) {
    case 'llm_call':
      return executeLlmCall(step, context);
    case 'http_request':
      return executeHttpRequest(step, context);
    case 'db_write':
      throw new Error('db_write executor not yet implemented');
    case 'notify':
      throw new Error('notify executor not yet implemented');
    case 'conditional_branch':
      throw new Error('conditional_branch executor not yet implemented');
    default:
      throw new Error(`Unknown step type: ${step.type}`);
  }
}
