/**
 * 知识点 5.3：天气工具实现（模拟数据）
 *
 * 学习要点：
 * - 工具函数的签名设计（接收参数对象，返回结果字符串）
 * - 模拟数据返回（实际项目中替换为真实 API 调用）
 * - 类型安全的参数处理
 */

interface WeatherParams {
  city: string
}

interface WeatherResult {
  city: string
  temperature: number
  condition: string
  humidity: number
}

/**
 * 模拟天气查询
 * 📝 面试考点：工具函数返回 JSON 字符串，AI 会基于它生成自然语言回复
 */
export const getWeather = (params: WeatherParams): string => {
  // 模拟不同城市的天气数据
  const weatherData: Record<string, WeatherResult> = {
    '北京': { city: '北京', temperature: 28, condition: '晴', humidity: 45 },
    '上海': { city: '上海', temperature: 32, condition: '多云', humidity: 72 },
    '深圳': { city: '深圳', temperature: 34, condition: '阵雨', humidity: 85 },
    '广州': { city: '广州', temperature: 33, condition: '雷阵雨', humidity: 88 },
    '杭州': { city: '杭州', temperature: 30, condition: '晴', humidity: 60 },
  }

  const result = weatherData[params.city]
  if (result) {
    return JSON.stringify(result)
  }

  // 未匹配的城市返回随机数据
  return JSON.stringify({
    city: params.city,
    temperature: Math.floor(Math.random() * 15) + 20,
    condition: '晴',
    humidity: Math.floor(Math.random() * 40) + 40,
  })
}
