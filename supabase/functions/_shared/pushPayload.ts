export type PushPayloadInput = {
  title: string
  body: string
  tag: string
  route: string
  baseUrl: string
}

export type DeclarativePushPayload = {
  web_push: 8030
  notification: {
    title: string
    body: string
    navigate: string
    icon: string
    tag: string
    silent: false
    app_badge: '1'
    data: { route: string }
  }
}

export function buildDeclarativePushPayload({
  title,
  body,
  tag,
  route,
  baseUrl,
}: PushPayloadInput): DeclarativePushPayload {
  const appUrl = new URL(baseUrl)
  const navigate = new URL(route, appUrl).href
  const icon = new URL('icons/bobo-heart-512.png', appUrl).href

  return {
    web_push: 8030,
    notification: {
      title,
      body,
      navigate,
      icon,
      tag,
      silent: false,
      app_badge: '1',
      data: { route },
    },
  }
}
