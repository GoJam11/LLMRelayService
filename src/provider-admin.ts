/**
 * 渠道管理里那些「不只是读写配置」的操作：连通性测试、拉上游模型、模型元数据覆盖。
 *
 * 控制台（cookie 鉴权的 /__console/api）和对外 OpenAPI（Bearer 鉴权的 /api/v1）
 * 都要用这几件事，逻辑本身跟鉴权方式无关，所以抽在这里，两边路由只负责鉴权和
 * 响应包装。函数统一返回 { status, body }，由调用方决定怎么塞进各自的响应外壳。
 */
import { ensureProviderConfigsLoaded, getChannelModels, getProviderConfig, type ModelInfo } from './config';
import { ensureModelCatalogLoaded, lookupModelContext } from './model-catalog';
import { ensurePricingLoaded, getModelPricing } from './pricing';
import { getModelOverrideKey, listModelMetadataOverrides, upsertModelMetadataOverride } from './model-metadata-overrides';
import { fetchUpstreamModelIds } from './upstream-models';

export type AdminStatus = 200 | 400 | 404 | 502;

export interface AdminResult<T = unknown> {
  status: AdminStatus;
  body: T;
}

export interface UpstreamModelsPreviewInput {
  targetBaseUrl?: string;
  type?: 'openai' | 'anthropic';
  authHeader?: string;
  authValue?: string;
}

const PROVIDER_TEST_TIMEOUT_MS = 30000;

function enrichModel(
  model: ModelInfo,
  overrides: Map<string, { context?: number; pricing?: unknown; updatedAt: number }>,
) {
  const override = overrides.get(getModelOverrideKey(model.channelName, model.id));
  const pricing = override?.pricing ?? getModelPricing(model.id);
  const context = override?.context ?? model.context ?? lookupModelContext(model.id);

  return {
    ...model,
    context,
    ...(pricing ? { pricing } : {}),
    ...(override
      ? {
          override: {
            ...(override.context != null ? { context: override.context } : {}),
            ...(override.pricing ? { pricing: override.pricing } : {}),
            updatedAt: override.updatedAt,
          },
        }
      : {}),
  };
}

/** 所有启用渠道的模型，按 openai / anthropic 分组，附带价格与上下文（含手动覆盖）。 */
export async function listChannelModelsWithMetadata(): Promise<{ openai: unknown[]; anthropic: unknown[] }> {
  await ensureProviderConfigsLoaded();
  await Promise.all([ensureModelCatalogLoaded(), ensurePricingLoaded()]);

  const rawModels = getChannelModels();
  const overrides = await listModelMetadataOverrides();

  return {
    openai: rawModels.filter((m) => m.type === 'openai').map((m) => enrichModel(m, overrides)),
    anthropic: rawModels.filter((m) => m.type === 'anthropic').map((m) => enrichModel(m, overrides)),
  };
}

/** 手动覆盖某个渠道模型的上下文长度和价格。 */
export async function setChannelModelMetadata(
  channelName: string,
  modelId: string,
  payload: unknown,
): Promise<AdminResult> {
  await ensureProviderConfigsLoaded();

  const model = getChannelModels().find((item) => item.channelName === channelName && item.id === modelId);
  if (!model) {
    return { status: 404, body: { error: '模型不存在' } };
  }

  try {
    const override = await upsertModelMetadataOverride(channelName, modelId, payload as any);
    await Promise.all([ensureModelCatalogLoaded(), ensurePricingLoaded()]);
    const pricing = override?.pricing ?? getModelPricing(model.id);
    const context = override?.context ?? model.context ?? lookupModelContext(model.id);

    return {
      status: 200,
      body: {
        ...model,
        context,
        ...(pricing ? { pricing } : {}),
        ...(override
          ? {
              override: {
                ...(override.context != null ? { context: override.context } : {}),
                ...(override.pricing ? { pricing: override.pricing } : {}),
                updatedAt: override.updatedAt,
              },
            }
          : {}),
      },
    };
  } catch (error) {
    return { status: 400, body: { error: error instanceof Error ? error.message : String(error) } };
  }
}

/** 用已保存的渠道配置去问上游 /models。 */
export async function listUpstreamModelsForChannel(channelName: string): Promise<AdminResult> {
  await ensureProviderConfigsLoaded();

  const provider = getProviderConfig(channelName);
  if (!provider) {
    return { status: 404, body: { error: 'Provider 不存在' } };
  }

  const auth = provider.auth;
  if (!auth?.value) {
    return { status: 400, body: { error: '该渠道未配置认证信息，无法请求上游 models 接口' } };
  }

  try {
    const ids = await fetchUpstreamModelIds({
      targetBaseUrl: provider.targetBaseUrl,
      type: provider.type === 'anthropic' ? 'anthropic' : 'openai',
      authHeader: auth.header,
      authValue: auth.value,
    });
    return { status: 200, body: { models: ids.map((id) => ({ id })) } };
  } catch (err) {
    return { status: 502, body: { error: err instanceof Error ? err.message : String(err) } };
  }
}

/** 用请求里现给的连接参数问上游 /models（渠道还没保存时用）。 */
export async function previewUpstreamModels(input: UpstreamModelsPreviewInput): Promise<AdminResult> {
  const baseUrl = (input.targetBaseUrl ?? '').replace(/\/$/, '');
  if (!baseUrl) {
    return { status: 400, body: { error: 'targetBaseUrl 不能为空' } };
  }
  if (!input.authValue) {
    return { status: 400, body: { error: '未填写认证信息（Credential），无法请求上游 models 接口' } };
  }

  const headerName = input.authHeader && input.authHeader !== 'auto'
    ? (input.authHeader as 'x-api-key' | 'authorization')
    : input.type === 'anthropic' ? 'x-api-key' : 'authorization';

  try {
    const ids = await fetchUpstreamModelIds({
      targetBaseUrl: baseUrl,
      type: input.type === 'anthropic' ? 'anthropic' : 'openai',
      authHeader: headerName,
      authValue: input.authValue,
    });
    return { status: 200, body: { models: ids.map((id) => ({ id })) } };
  } catch (err) {
    return { status: 502, body: { error: err instanceof Error ? err.message : String(err) } };
  }
}

/**
 * 拿渠道自己的凭据发一条最小请求，验证「地址 + 密钥 + 模型」这条链路通不通。
 * 上游返回错误时仍然是 HTTP 200，结果放在 body.status 里，方便前端逐个渠道展示。
 */
export async function testProviderConnectivity(
  channelName: string,
  requestedModel?: string,
): Promise<AdminResult> {
  await ensureProviderConfigsLoaded();

  // 用 getProviderConfig 而不是 getProviderInfo：这里需要真实的 auth value
  const provider = getProviderConfig(channelName);
  if (!provider) {
    console.log(`[ProviderTest] ${channelName}: Provider 不存在`);
    return { status: 404, body: { error: 'Provider 不存在' } };
  }

  const auth = provider.auth;
  if (!auth?.value) {
    console.log(`[ProviderTest] ${channelName}: 认证未配置`);
    return { status: 400, body: { error: '认证未配置' } };
  }

  const testModel = requestedModel || provider.models?.[0]?.model;
  if (!testModel) {
    console.log(`[ProviderTest] ${channelName}: 未配置模型`);
    return { status: 400, body: { error: '未配置模型' } };
  }

  console.log(`[ProviderTest] ${channelName}: 开始测试 model=${testModel} url=${provider.targetBaseUrl}`);

  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PROVIDER_TEST_TIMEOUT_MS);

    let testUrl: string;
    let headers: Record<string, string>;
    let body: object;
    const authHeaders: Record<string, string> = {};
    if (auth.header === 'authorization') {
      authHeaders.Authorization = auth.value;
    } else {
      authHeaders['x-api-key'] = auth.value;
    }

    // 路径拼接规则：
    // - OpenAI 类型：不补 /v1，用户必须在 targetBaseUrl 中包含 /v1
    // - Anthropic 类型：如果不包含 /v1 则补，这是行业惯例
    const baseUrl = provider.targetBaseUrl.replace(/\/$/, '');

    if (provider.type === 'anthropic') {
      const v1Prefix = baseUrl.endsWith('/v1') ? '' : '/v1';
      testUrl = baseUrl + v1Prefix + '/messages';
      headers = {
        ...authHeaders,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      };
      body = {
        model: testModel,
        messages: [{ role: 'user', content: 'Reply with exactly "OK"' }],
        max_tokens: 1024,
      };
    } else {
      testUrl = baseUrl + '/chat/completions';
      headers = {
        ...authHeaders,
        'content-type': 'application/json',
      };
      body = {
        model: testModel,
        messages: [{ role: 'user', content: 'Reply with exactly "OK"' }],
        max_tokens: 1024,
      };
    }

    const response = await fetch(testUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const latencyMs = Date.now() - startTime;

    console.log(`[ProviderTest] ${channelName}: HTTP ${response.status} bodySize=${response.headers.get('content-length')}`);

    if (response.ok) {
      const data = await response.json().catch(() => ({} as any));
      console.log(`[ProviderTest] ${channelName}: 响应数据 ${JSON.stringify(data).slice(0, 1000)}`);

      // 检查响应内容是否包含 OK（需要处理 thinking 类型的 content）
      let content = '';
      let hasThinking = false;
      let stopReason = '';
      if (provider.type === 'anthropic') {
        // 遍历所有 content 块，优先查找 text 类型，其次是 thinking
        const contents = data.content ?? [];
        console.log(`[ProviderTest] ${channelName}: content块数量=${contents.length}`);
        for (let i = 0; i < contents.length; i++) {
          const block = contents[i];
          console.log(`[ProviderTest] ${channelName}: content[${i}] type=${block.type}`);
          if (block.type === 'text') {
            content = block.text ?? '';
          } else if (block.type === 'thinking') {
            hasThinking = true;
            if (!content) {
              content = block.thinking ?? '';
            }
          }
        }
        stopReason = data.stop_reason ?? '';
      } else {
        content = data.choices?.[0]?.message?.content ?? '';
        stopReason = data.choices?.[0]?.finish_reason ?? '';
        // OpenAI 兼容的思考模型：content 可能在 reasoning_content 或类似字段
        if (!content && data.choices?.[0]?.message?.reasoning_content) {
          hasThinking = true;
          content = data.choices?.[0]?.message?.reasoning_content;
        }
      }

      console.log(`[ProviderTest] ${channelName}: 提取的content="${content.slice(0, 200)}" stopReason="${stopReason}" hasThinking=${hasThinking}`);

      if (content.toUpperCase().includes('OK')) {
        console.log(`[ProviderTest] ${channelName}: 成功 latencyMs=${latencyMs}`);
        return {
          status: 200,
          body: {
            status: 'ok',
            statusCode: response.status,
            message: '模型响应正常',
            latencyMs,
            model: testModel,
            rawResponse: data,
          },
        };
      }

      if (hasThinking || stopReason === 'max_tokens' || stopReason === 'stop') {
        // 思考模型可能只有 thinking 没有 text（max_tokens 不足），但连通性正常
        console.log(`[ProviderTest] ${channelName}: 思考模型连通正常 latencyMs=${latencyMs}`);
        return {
          status: 200,
          body: {
            status: 'ok',
            statusCode: response.status,
            message: '模型连通正常（思考模型，输出被截断）',
            latencyMs,
            model: testModel,
            rawResponse: data,
          },
        };
      }

      console.log(`[ProviderTest] ${channelName}: 响应内容异常`);
      return {
        status: 200,
        body: {
          status: 'error',
          statusCode: response.status,
          message: `HTTP ${response.status} - 响应内容为空或不含OK`,
          latencyMs,
          model: testModel,
          rawResponse: data,
        },
      };
    }

    const errorText = await response.text().catch(() => '');
    console.log(`[ProviderTest] ${channelName}: HTTP ${response.status} error="${errorText.slice(0, 200)}"`);

    // 尝试解析上游返回的错误信息
    let errorDetail = '';
    try {
      const errorJson = JSON.parse(errorText);
      errorDetail = errorJson.error?.message || errorJson.message || errorJson.error?.type || '';
    } catch {
      errorDetail = errorText.slice(0, 200);
    }

    // 针对常见错误码提供更友好的提示
    let friendlyMessage = `HTTP ${response.status}`;
    if (errorDetail) {
      friendlyMessage += `: ${errorDetail}`;
    } else if (response.status === 401) {
      friendlyMessage = 'API Key 无效或已过期';
    } else if (response.status === 403) {
      friendlyMessage = '无访问权限，请检查 API Key 权限设置';
    } else if (response.status === 429) {
      friendlyMessage = '请求频率超限，请稍后重试';
    } else if (response.status === 400) {
      friendlyMessage = '请求参数错误，请检查模型名称是否正确';
    }

    return {
      status: 200,
      body: {
        status: 'error',
        statusCode: response.status,
        message: friendlyMessage,
        latencyMs,
        model: testModel,
        rawResponse: errorText ? (() => {
          try {
            return JSON.parse(errorText);
          } catch {
            return errorText.slice(0, 1000);
          }
        })() : null,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`[ProviderTest] ${channelName}: 异常 ${message}`);

    if (message.includes('aborted')) {
      return {
        status: 200,
        body: {
          status: 'error',
          statusCode: 0,
          message: '请求超时（30秒）',
          latencyMs: PROVIDER_TEST_TIMEOUT_MS,
          model: testModel,
        },
      };
    }

    return {
      status: 200,
      body: {
        status: 'error',
        statusCode: 0,
        message: `连接失败: ${message}`,
        latencyMs: Date.now() - startTime,
        model: testModel,
      },
    };
  }
}
