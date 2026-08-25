/**
 * Embedding 服务
 * 调用智谱 AI 的 embedding 接口将文本转为向量
 */

function getEnv() {
  return {
    apiUrl: process.env.AI_API_URL || 'https://open.bigmodel.cn/api/paas/v4',
    apiKey: process.env.AI_API_KEY || '',
    model: process.env.EMBEDDING_MODEL || 'embedding-3',
  }
}

/** 将单段文本转为向量 */
export const getEmbedding = async (text: string): Promise<number[]> => {
  const { apiUrl, apiKey, model } = getEnv()
  const response = await fetch(`${apiUrl}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: text,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Embedding 请求失败 (${response.status}): ${errorText}`)
  }

  const data = (await response.json()) as {
    data: Array<{ embedding: number[] }>;
  }
  return data.data[0].embedding
}

/** 批量获取 embedding（每次最多 25 条） */
export const getEmbeddings = async (texts: string[]): Promise<number[][]> => {
  const results: number[][] = []
  // 分批处理，每批 10 条
  const batchSize = 10

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize)
    const batchResults = await Promise.all(batch.map(getEmbedding))
    results.push(...batchResults)
  }

  return results
}

/** 计算两个向量的余弦相似度 */
export const cosineSimilarity = (a: number[], b: number[]): number => {
  if (a.length !== b.length) return 0

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  if (denominator === 0) return 0

  return dotProduct / denominator
}
