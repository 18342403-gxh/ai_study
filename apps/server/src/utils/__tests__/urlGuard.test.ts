import { describe, expect, it } from 'vitest'

import {
  assertSafeUrl,
  assertSafeUrlSync,
  guardedFetch,
  isPrivateIp,
  UrlGuardError,
} from '../urlGuard.js'

describe('isPrivateIp', () => {
  it('识别 IPv4 私网与保留地址', () => {
    for (const ip of [
      '10.0.0.1',
      '10.255.255.255',
      '127.0.0.1',
      '172.16.0.1',
      '172.31.255.254',
      '192.168.1.2',
      '169.254.1.1',
      '0.0.0.0',
      '100.64.0.1',
      '224.0.0.1',
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true)
    }
  })

  it('识别 IPv6 回环/ULA/link-local/mapped', () => {
    for (const ip of [
      '::1',
      '::',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      'ff02::1',
      '::ffff:127.0.0.1',
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true)
    }
  })

  it('公网地址放行', () => {
    for (const ip of ['93.184.216.34', '8.8.8.8', '2606:4700::1111']) {
      expect(isPrivateIp(ip), ip).toBe(false)
    }
  })
})

describe('assertSafeUrlSync', () => {
  it('拒绝非 HTTP/HTTPS 与带凭据地址', () => {
    expect(() => assertSafeUrlSync('file:///etc/passwd')).toThrow('HTTP/HTTPS')
    expect(() => assertSafeUrlSync('ftp://example.com/a')).toThrow('HTTP/HTTPS')
    expect(() => assertSafeUrlSync('https://user:pass@example.com')).toThrow('账号或密码')
  })

  it('拒绝本机与内网字面量', () => {
    expect(() => assertSafeUrlSync('http://localhost:3001')).toThrow('内网')
    expect(() => assertSafeUrlSync('http://192.168.1.2')).toThrow('内网')
    expect(() => assertSafeUrlSync('http://[::1]:3001')).toThrow('内网')
  })

  it('公网域名通过', () => {
    expect(assertSafeUrlSync('https://example.com/a').hostname).toBe('example.com')
  })
})

describe('assertSafeUrl', () => {
  it('DNS 解析到私网 → 拒绝', async () => {
    await expect(
      assertSafeUrl('http://evil.example.com', { resolve: async () => ['10.0.0.9'] }),
    ).rejects.toThrow('内网')
  })

  it('多 A 记录中任意一个私网 → 拒绝', async () => {
    await expect(
      assertSafeUrl('http://mixed.example.com', {
        resolve: async () => ['93.184.216.34', '127.0.0.1'],
      }),
    ).rejects.toThrow('内网')
  })

  it('解析失败 → 明确错误', async () => {
    await expect(
      assertSafeUrl('http://nope.example.com', {
        resolve: async () => {
          throw new Error('ENOTFOUND')
        },
      }),
    ).rejects.toThrow('无法解析')
  })

  it('公网解析结果放行', async () => {
    const url = await assertSafeUrl('https://example.com', {
      resolve: async () => ['93.184.216.34'],
    })
    expect(url.hostname).toBe('example.com')
  })
})

describe('guardedFetch', () => {
  const resolve = async () => ['93.184.216.34']

  it('重定向到内网地址被拦截', async () => {
    const fetchImpl = (async () =>
      new Response(null, {
        status: 302,
        headers: { location: 'http://127.0.0.1:3001/api/health' },
      })) as typeof fetch

    await expect(guardedFetch('https://example.com/a', {}, { fetchImpl, resolve })).rejects.toThrow(
      '内网',
    )
  })

  it('超过最大跳数被拦截', async () => {
    let n = 0
    const fetchImpl = (async () => {
      n++
      return new Response(null, {
        status: 302,
        headers: { location: `https://example.com/r${n}` },
      })
    }) as typeof fetch

    await expect(guardedFetch('https://example.com/a', {}, { fetchImpl, resolve })).rejects.toThrow(
      '跳转次数过多',
    )
  })

  it('正常响应返回最终地址', async () => {
    const fetchImpl = (async () => new Response('ok', { status: 200 })) as typeof fetch
    const result = await guardedFetch('https://example.com/a', {}, { fetchImpl, resolve })
    expect(result.response.status).toBe(200)
    expect(result.finalUrl).toBe('https://example.com/a')
  })

  it('错误类型可判定', async () => {
    try {
      await assertSafeUrl('http://localhost', { resolve })
      throw new Error('should throw')
    } catch (err) {
      expect(err).toBeInstanceOf(UrlGuardError)
      expect((err as UrlGuardError).code).toBe('UNSAFE_HOST')
    }
  })
})
