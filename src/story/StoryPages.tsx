import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { storyContent, type GalleryPhoto, type MemoryPage } from '../content/storyContent'
import {
  loadStoryProgress,
  markGalleryPhotoViewed,
  unlockStoryWorld,
} from '../storage'

function navigate(route: string) {
  const nextHash = `#${route}`
  if (window.location.hash === nextHash) {
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  } else {
    window.location.hash = route
  }
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  return reduced
}

function StoryImage({
  src,
  alt,
  number,
  objectPosition,
}: {
  src: string
  alt: string
  number?: number
  objectPosition?: string
}) {
  const [missing, setMissing] = useState(!src)

  useEffect(() => setMissing(!src), [src])

  if (missing) {
    return (
      <div className='story-image-placeholder' role='img' aria-label={alt}>
        <span>{number ? String(number).padStart(2, '0') : '♡'}</span>
        <p>YOUR PHOTO GOES HERE</p>
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={alt}
      style={objectPosition ? { objectPosition } : undefined}
      onError={() => setMissing(true)}
    />
  )
}

function MemorySheet({ page, index }: { page: MemoryPage; index: number }) {
  return (
    <article className='memory-sheet'>
      <div className='photo-corners' aria-hidden='true'><i /><i /><i /><i /></div>
      <div className='memory-photo'>
        <StoryImage
          src={page.image}
          alt={page.alt}
          number={index + 1}
          objectPosition={page.objectPosition}
        />
      </div>
      {page.date && <p className='memory-date'>{page.date}</p>}
      <p className='memory-caption'>{page.caption}</p>
      <span className='memory-doodle memory-doodle--heart' aria-hidden='true'>♥</span>
      <span className='memory-doodle memory-doodle--spark' aria-hidden='true'>✦</span>
    </article>
  )
}

export type StoryDestination = {
  id: 'scrapbook' | 'world' | 'cinema' | 'gallery'
  route: string
  title: string
  description: string
  icon: string
  requiresScrapbook: boolean
}

const storyDestinations: StoryDestination[] = [
  {
    id: 'scrapbook',
    route: '/scrapbook',
    title: 'Turn our scrapbook pages',
    description: 'Ten little pieces of us, kept safe between pink pages.',
    icon: '▤',
    requiresScrapbook: false,
  },
  {
    id: 'world',
    route: '/world',
    title: 'Follow the kitten',
    description: 'Walk the curved paths to the two tiny houses.',
    icon: 'ᨒ',
    requiresScrapbook: true,
  },
  {
    id: 'cinema',
    route: '/cinema',
    title: 'Watch our little movie',
    description: 'The cutest audience already saved us the best seats.',
    icon: '▶',
    requiresScrapbook: true,
  },
  {
    id: 'gallery',
    route: '/gallery-room',
    title: 'Visit the memory room',
    description: 'Open every frame and find the letter waiting inside.',
    icon: '▣',
    requiresScrapbook: true,
  },
]

function StoryNavigation({ light = false }: { light?: boolean }) {
  return (
    <nav className={`story-travel-nav${light ? ' story-travel-nav--light' : ''}`} aria-label='Our little world navigation'>
      <a href='#/' aria-label='Back to the pink sky'>← SKY</a>
      <a href='#/memories'>♡ OUR PLACES</a>
    </nav>
  )
}

export function MemoriesPage() {
  const unlocked = loadStoryProgress().scrapbookCompleted

  return (
    <main className='story-screen memories-screen'>
      <StoryNavigation />
      <header className='memories-heading'>
        <div className='memories-guide-cat' aria-hidden='true'><PixelKitten /></div>
        <h1>Where should our hearts go?</h1>
        <p>{unlocked ? 'Every little place is waiting for us.' : 'Our scrapbook knows the way. Finish it once to open the whole world.'}</p>
      </header>

      <section className='memory-destination-map' aria-label='Choose a place in our little world'>
        <div className='destination-path' aria-hidden='true'><i /><i /><i /></div>
        {storyDestinations.map((destination, index) => {
          const locked = destination.requiresScrapbook && !unlocked
          const content = (
            <>
              <span className='destination-number'>{String(index + 1).padStart(2, '0')}</span>
              <span className='destination-icon' aria-hidden='true'>{locked ? '♙' : destination.icon}</span>
              <strong>{destination.title}</strong>
              <span className='destination-description'>{destination.description}</span>
              <span className='destination-status'>{locked ? 'finish our scrapbook to unlock' : 'enter →'}</span>
            </>
          )

          return locked ? (
            <div className={`story-destination story-destination--${destination.id} story-destination--locked`} aria-disabled='true' key={destination.id}>
              {content}
            </div>
          ) : (
            <a className={`story-destination story-destination--${destination.id}`} data-sound='door' href={`#${destination.route}`} key={destination.id}>
              {content}
            </a>
          )
        })}
      </section>
    </main>
  )
}

export function ScrapbookPage() {
  const pages = storyContent.memories
  const [index, setIndex] = useState(0)
  const [direction, setDirection] = useState<'next' | 'previous'>('next')
  const [closing, setClosing] = useState(false)
  const pointerStart = useRef<number | null>(null)
  const reducedMotion = useReducedMotion()

  const previous = () => {
    if (index === 0) return
    setDirection('previous')
    setIndex((current) => current - 1)
  }

  const finish = () => {
    unlockStoryWorld()
    setClosing(true)
    window.setTimeout(() => navigate('/world'), reducedMotion ? 20 : 650)
  }

  const next = () => {
    if (index >= pages.length - 1) {
      finish()
      return
    }
    setDirection('next')
    setIndex((current) => current + 1)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') previous()
      if (event.key === 'ArrowRight') next()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const onPointerDown = (event: ReactPointerEvent) => {
    pointerStart.current = event.clientX
  }

  const onPointerUp = (event: ReactPointerEvent) => {
    if (pointerStart.current === null) return
    const distance = event.clientX - pointerStart.current
    pointerStart.current = null
    if (Math.abs(distance) < 55) return
    if (distance < 0) next()
    else previous()
  }

  if (pages.length === 0) {
    return (
      <main className='story-screen scrapbook-screen'>
        <StoryNavigation light />
        <section className='empty-story-page'>
          <h1>Our scrapbook is waiting</h1>
          <p>Add your first memory in the story content file.</p>
          <button className='pixel-button' type='button' onClick={finish}>FOLLOW THE PAWPRINTS</button>
        </section>
      </main>
    )
  }

  const page = pages[index]

  return (
    <main className={`story-screen scrapbook-screen${closing ? ' scrapbook-screen--closing' : ''}`}>
      <div className='scrapbook-stars' aria-hidden='true'><i>✦</i><i>♥</i><i>✦</i><i>♥</i></div>
      <StoryNavigation light />
      <section className='scrapbook-wrap' aria-label='Our scrapbook'>
        <div className='scrapbook-title'>
          <span>OUR LITTLE BOOK OF</span>
          <h1>US ♡</h1>
        </div>
        <div
          className='scrapbook-book'
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
        >
          <div className='book-spine' aria-hidden='true' />
          <div className='book-cover' aria-hidden='true' />
          <div className={`page-turn page-turn--${direction}`} key={page.id}>
            <MemorySheet page={page} index={index} />
          </div>
        </div>
        <div className='scrapbook-controls'>
          <button type='button' data-sound='page' onClick={previous} disabled={index === 0} aria-label='Previous memory'>←</button>
          <p>{index + 1} / {pages.length}</p>
          <button type='button' data-sound='page' onClick={next} aria-label={index === pages.length - 1 ? 'Finish scrapbook' : 'Next memory'}>→</button>
        </div>
        <button className='finish-book' data-sound='door' type='button' onClick={finish} hidden={index !== pages.length - 1}>
          FOLLOW THE PAWPRINTS ᨒ
        </button>
        <p className='swipe-hint'>swipe, tap the arrows, or use ← →</p>
      </section>
      {closing && <div className='pawprint-trail' aria-hidden='true'><i>•</i><i>•</i><i>•</i><i>•</i><i>ᨒ</i></div>}
    </main>
  )
}

type Point = { x: number; y: number }
type DoorId = 'cinema' | 'gallery'

const doors: Record<DoorId, Point & { route: string }> = {
  cinema: { x: 25, y: 25, route: '/cinema' },
  gallery: { x: 75, y: 25, route: '/gallery-room' },
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function WorldLandscape() {
  const roadPath = 'M600 748C590 675 625 620 600 535M600 535C500 520 380 450 325 350C300 305 300 260 300 230M600 535C700 520 820 450 875 350C900 305 900 260 900 230'

  return (
    <svg className='world-landscape' viewBox='0 0 1200 700' preserveAspectRatio='none' aria-hidden='true'>
      <rect width='1200' height='270' fill='#f8b5c9' />
      <path d='M0 224 90 170l86 35 98-74 108 73 99-45 106 57 102-83 117 74 105-50 93 58 96-50v105H0Z' fill='#ee8faf' />
      <path d='M0 250 94 214l89 28 92-48 113 55 102-30 109 38 117-52 101 47 112-32 99 35 72-21v87H0Z' fill='#df6f9a' />
      <rect y='270' width='1200' height='430' fill='#c95783' />
      <path className='world-path-border' d={roadPath} />
      <path className='world-path-stroke' d={roadPath} />
      <path className='world-path-dashes' d={roadPath} />
      <g className='world-water'>
        <path d='M952 534h142l25 22-20 57-45 18H934l-31-25 9-50Z' fill='#f8cadd' stroke='#803055' strokeWidth='8' />
        <path d='M935 574c40-18 91 17 149-5' fill='none' stroke='#e873a3' strokeWidth='9' />
        <path d='M960 603c28-12 63 8 92-4' fill='none' stroke='#fff1df' strokeWidth='6' />
      </g>
      <g fill='#fff2db'>
        <path d='m95 334 8 13 15 4-11 10 1 16-13-7-14 7 3-16-11-10 15-3Z' />
        <path d='m1105 335 7 11 14 4-10 9 1 14-12-6-12 6 2-14-10-9 14-3Z' />
        <path d='m141 551 7 11 14 4-10 9 1 14-12-6-12 6 2-14-10-9 14-3Z' />
      </g>
      <g className='world-clouds' fill='#fff2e8'>
        <path d='M28 112h132v42H8v-24h29c4-25 39-34 56-16 16-34 64-22 67-2Z' />
        <path d='M1056 76h116v40h28v24h-174v-25h24c5-22 32-31 49-17 13-30 52-24 57-2Z' />
      </g>
    </svg>
  )
}

function PixelKitten() {
  return (
    <svg className='world-kitten-svg' viewBox='0 0 96 82' aria-hidden='true' shapeRendering='geometricPrecision'>
      <ellipse cx='50' cy='75' rx='33' ry='5' fill='#7b264d' opacity='.3' />
      <path d='M70 51c15-5 19-19 9-25-8-5-14 2-10 8' fill='none' stroke='#622044' strokeWidth='7' strokeLinecap='round' />
      <path d='M40 43h31c10 0 16 7 16 17v6H30V55c0-7 4-12 10-12Z' fill='#fff6e7' stroke='#622044' strokeWidth='4' />
      <path d='M49 55h10v17H46V59m25-4h10v17H68V59' fill='#fff6e7' stroke='#622044' strokeWidth='4' strokeLinejoin='round' />
      <path d='m18 21 3-17 15 11c8-4 18-4 27 0L78 4l2 19c5 6 6 17 2 25-5 10-18 13-32 13-18 0-33-7-35-19-2-8 0-15 3-21Z' fill='#fff9ec' stroke='#622044' strokeWidth='4' strokeLinejoin='round' />
      <path d='m23 13 2 10 8-7Zm48 1-2 10-8-8Z' fill='#f3a7b9' />
      <path d='M30 31h7m25 0h7' stroke='#622044' strokeWidth='5' strokeLinecap='round' />
      <path d='m48 37 4 3 4-3' fill='#e86f97' stroke='#622044' strokeWidth='2' strokeLinejoin='round' />
      <path d='M52 41c0 5-4 7-8 5m8-5c0 5 4 7 8 5' fill='none' stroke='#622044' strokeWidth='2.5' strokeLinecap='round' />
      <path d='M25 41h13m-12 6h12m40-6H65m12 6H65' stroke='#a94b70' strokeWidth='2' strokeLinecap='round' />
      <circle cx='31' cy='39' r='4' fill='#f4a4b7' opacity='.75' />
      <circle cx='72' cy='39' r='4' fill='#f4a4b7' opacity='.75' />
      <path d='M44 51h16l-3 9-5 4-5-4Z' fill='#e04f86' stroke='#622044' strokeWidth='3' />
      <path d='m52 55-3 4 3 4 3-4Z' fill='#fff0a7' />
    </svg>
  )
}

type CinemaAnimalKind = 'hamster' | 'kitten' | 'duck' | 'puppy'

function CinemaAnimal({ kind, variant = 0 }: { kind: CinemaAnimalKind; variant?: number }) {
  if (kind === 'hamster') {
    return (
      <svg className={`seat-animal seat-animal--hamster seat-animal--v${variant}`} viewBox='0 0 80 76' aria-hidden='true'>
        <circle cx='19' cy='22' r='12' fill='#d99664' stroke='#541a37' strokeWidth='4' />
        <circle cx='61' cy='22' r='12' fill='#d99664' stroke='#541a37' strokeWidth='4' />
        <path d='M13 48c0-22 11-34 27-34s27 12 27 34v23H13Z' fill={variant ? '#d8945f' : '#e5aa70'} stroke='#541a37' strokeWidth='4' />
        <path d='M26 34c4-10 24-10 28 0l-2 22H28Z' fill='#fff0d2' />
        <circle cx='30' cy='34' r='3.5' fill='#541a37' /><circle cx='50' cy='34' r='3.5' fill='#541a37' />
        <path d='m37 42 3 3 3-3M40 45v5' fill='none' stroke='#541a37' strokeWidth='2.5' strokeLinecap='round' />
        <circle cx='23' cy='44' r='5' fill='#f48e9e' /><circle cx='57' cy='44' r='5' fill='#f48e9e' />
        <path d='M27 56h26v16H27Z' fill='#fff0d6' stroke='#541a37' strokeWidth='3' />
        <path d='m32 57 3-7m6 7 3-8m3 8 4-7' stroke='#efc84e' strokeWidth='3' />
      </svg>
    )
  }

  if (kind === 'kitten') {
    return (
      <svg className={`seat-animal seat-animal--kitten seat-animal--v${variant}`} viewBox='0 0 80 76' aria-hidden='true'>
        <path d='m15 23 4-19 15 11c5-2 10-2 15 0L64 4l3 20c6 7 5 21-2 29-7 8-42 8-49 0-7-8-7-22-1-30Z' fill={variant ? '#f3c6a5' : '#fff4df'} stroke='#541a37' strokeWidth='4' strokeLinejoin='round' />
        <path d='m21 13 1 10 8-7Zm38 0-1 10-8-7Z' fill='#eb97aa' />
        <path d='M23 33h8m18 0h8' stroke='#541a37' strokeWidth='4' strokeLinecap='round' />
        <path d='m37 41 3 3 3-3m-3 3c0 5-5 6-8 3m8-3c0 5 5 6 8 3' fill='none' stroke='#541a37' strokeWidth='2.5' strokeLinecap='round' />
        <circle cx='24' cy='42' r='4' fill='#f09aaa' /><circle cx='56' cy='42' r='4' fill='#f09aaa' />
        <path d='M24 57c3-7 29-7 33 0l5 15H18Z' fill={variant ? '#e6aa84' : '#ffedcf'} stroke='#541a37' strokeWidth='4' />
        <path d='m40 57-4 5 4 5 4-5Z' fill='#df4f83' />
      </svg>
    )
  }

  if (kind === 'duck') {
    return (
      <svg className='seat-animal seat-animal--duck' viewBox='0 0 80 76' aria-hidden='true'>
        <path d='M22 28C22 12 31 5 43 5s23 8 23 25c0 10-5 18-11 22 8 4 12 11 12 20H15c0-9 5-17 13-20-4-5-6-13-6-24Z' fill='#ffd95f' stroke='#541a37' strokeWidth='4' />
        <path d='M37 26h7m13 0h6' stroke='#541a37' strokeWidth='4' strokeLinecap='round' />
        <path d='M43 32h20l7 6-8 7H43l-7-7Z' fill='#f18a53' stroke='#541a37' strokeWidth='3' strokeLinejoin='round' />
        <circle cx='28' cy='38' r='5' fill='#f2a0a3' />
        <path d='M25 61c5-7 25-7 31 0' fill='none' stroke='#efb537' strokeWidth='5' strokeLinecap='round' />
        <path d='m36 10 4-8 3 9 7-6' fill='none' stroke='#541a37' strokeWidth='3' strokeLinecap='round' />
      </svg>
    )
  }

  return (
    <svg className={`seat-animal seat-animal--puppy seat-animal--v${variant}`} viewBox='0 0 80 76' aria-hidden='true'>
      <path d='M22 17c-14 0-18 12-13 28 2 7 8 7 15 1m34-29c14 0 18 12 13 28-2 7-8 7-15 1' fill={variant ? '#a9644f' : '#bc7a5b'} stroke='#541a37' strokeWidth='4' strokeLinejoin='round' />
      <path d='M20 29C20 12 29 6 40 6s20 6 20 23v17c0 12-8 18-20 18s-20-6-20-18Z' fill={variant ? '#d69a72' : '#e3b081'} stroke='#541a37' strokeWidth='4' />
      <path d='M24 18c7-6 12-6 16-5-3 8-8 14-18 16' fill='#fff0d7' opacity='.85' />
      <circle cx='31' cy='34' r='3.5' fill='#541a37' /><circle cx='49' cy='34' r='3.5' fill='#541a37' />
      <path d='M29 43c3-8 19-8 22 0 0 9-5 15-11 15s-11-6-11-15Z' fill='#f5dec1' />
      <path d='m35 43 5-4 5 4-5 5Z' fill='#541a37' />
      <path d='M40 48v4m0 0c-3 0-6-1-7-3m7 3c3 0 6-1 7-3' fill='none' stroke='#541a37' strokeWidth='2.5' strokeLinecap='round' />
      <path d='M37 52h7v8c-1 3-6 3-7 0Z' fill='#ef7e91' />
      <path d='M23 62c5-5 29-5 34 0l5 10H18Z' fill={variant ? '#bd795e' : '#cc8e68'} stroke='#541a37' strokeWidth='4' />
    </svg>
  )
}

function LilyFlower() {
  return (
    <svg className='lily-flower-svg' viewBox='0 0 80 120' aria-hidden='true'>
      <path d='M42 48c-3 21-2 45 2 72' fill='none' stroke='#63945d' strokeWidth='5' />
      <path d='M42 82c-13-13-25-11-29-7 7 13 18 18 30 16M43 96c12-13 23-12 28-8-7 12-16 17-27 16' fill='#83b875' stroke='#365a41' strokeWidth='3' strokeLinejoin='round' />
      <g stroke='#8d355d' strokeWidth='2.5' strokeLinejoin='round'>
        <path d='M40 48C22 44 8 31 8 17c14-2 28 7 34 26Z' fill='var(--lily-petal, #fff2e3)' />
        <path d='M42 47C58 43 72 30 73 16c-15-2-28 8-34 28Z' fill='var(--lily-petal, #fff2e3)' />
        <path d='M40 45C29 31 27 14 38 3c12 8 15 25 6 41Z' fill='var(--lily-petal-light, #fff9ed)' />
        <path d='M39 48C23 53 12 48 5 38c10-8 25-7 36 6Z' fill='var(--lily-petal-light, #fff9ed)' />
        <path d='M43 48c15 6 28 2 35-8-9-9-25-8-37 4Z' fill='var(--lily-petal-light, #fff9ed)' />
        <path d='M42 45c12-13 13-29 4-40-12 7-17 23-8 39Z' fill='var(--lily-petal, #fff2e3)' />
      </g>
      <g fill='#f3bd58' stroke='#774254' strokeWidth='1.5'>
        <circle cx='31' cy='30' r='3' /><circle cx='40' cy='27' r='3' /><circle cx='49' cy='31' r='3' />
        <path d='m32 33 6 14m2-17v17m8-13-7 14' fill='none' />
      </g>
      <circle cx='41' cy='47' r='5' fill='#e8789b' stroke='#8d355d' strokeWidth='2' />
    </svg>
  )
}

function CinemaLilyFinale() {
  return (
    <div className='cinema-lily-finale' data-testid='cinema-lily-finale' role='status' aria-label='Lily flowers are floating up after our movie'>
      {Array.from({ length: 12 }, (_, index) => (
        <span className='floating-lily' key={index}><LilyFlower /></span>
      ))}
    </div>
  )
}

export function WorldPage() {
  const fieldRef = useRef<HTMLDivElement>(null)
  const kittenRef = useRef<HTMLDivElement>(null)
  const positionRef = useRef<Point>({ x: 50, y: 82 })
  const targetRef = useRef<Point | null>(null)
  const keys = useRef(new Set<string>())
  const startMovement = useRef<() => void>(() => undefined)
  const nearbyDoorRef = useRef<DoorId | undefined>(undefined)
  const [nearDoor, setNearDoor] = useState<DoorId | undefined>()
  const reducedMotion = useReducedMotion()

  useEffect(() => {
    let frame = 0
    let running = false
    let previousTime = performance.now()

    const renderKitten = () => {
      const field = fieldRef.current
      const kitten = kittenRef.current
      if (!field || !kitten) return
      const { x, y } = positionRef.current
      kitten.style.transform = `translate3d(${(x / 100) * field.clientWidth}px, ${(y / 100) * field.clientHeight}px, 0) translate(-50%, -50%)`
    }

    const syncNearbyDoor = () => {
      const found = (Object.keys(doors) as DoorId[]).find(
        (id) => distance(positionRef.current, doors[id]) < 9,
      )
      if (found !== nearbyDoorRef.current) {
        nearbyDoorRef.current = found
        setNearDoor(found)
      }
    }

    const stop = () => {
      running = false
      kittenRef.current?.classList.remove('world-kitten--moving')
    }

    const tick = (time: number) => {
      const elapsed = Math.min((time - previousTime) / 1000, 0.05)
      previousTime = time
      let dx = 0
      let dy = 0
      if (keys.current.has('arrowleft') || keys.current.has('a')) dx -= 1
      if (keys.current.has('arrowright') || keys.current.has('d')) dx += 1
      if (keys.current.has('arrowup') || keys.current.has('w')) dy -= 1
      if (keys.current.has('arrowdown') || keys.current.has('s')) dy += 1

      let active = false
      if (dx || dy) {
        targetRef.current = null
        const length = Math.hypot(dx, dy)
        positionRef.current = {
          x: Math.max(4, Math.min(96, positionRef.current.x + (dx / length) * 25 * elapsed)),
          y: Math.max(20, Math.min(91, positionRef.current.y + (dy / length) * 25 * elapsed)),
        }
        active = true
      } else if (targetRef.current) {
        const destination = targetRef.current
        const targetX = destination.x - positionRef.current.x
        const targetY = destination.y - positionRef.current.y
        const remaining = Math.hypot(targetX, targetY)
        if (remaining < 0.6 || reducedMotion) {
          positionRef.current = destination
          targetRef.current = null
        } else {
          const step = Math.min(remaining, 26 * elapsed)
          positionRef.current = {
            x: positionRef.current.x + (targetX / remaining) * step,
            y: positionRef.current.y + (targetY / remaining) * step,
          }
          active = true
        }
        if (targetX < 0) kittenRef.current?.classList.add('world-kitten--left')
        if (targetX > 0) kittenRef.current?.classList.remove('world-kitten--left')
      }

      if (dx < 0) kittenRef.current?.classList.add('world-kitten--left')
      if (dx > 0) kittenRef.current?.classList.remove('world-kitten--left')
      renderKitten()
      syncNearbyDoor()

      if (active || keys.current.size > 0 || targetRef.current) {
        frame = requestAnimationFrame(tick)
      } else {
        stop()
      }
    }

    startMovement.current = () => {
      if (running) return
      running = true
      previousTime = performance.now()
      if (!reducedMotion) kittenRef.current?.classList.add('world-kitten--moving')
      frame = requestAnimationFrame(tick)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && ['BUTTON', 'INPUT', 'TEXTAREA', 'VIDEO'].includes(event.target.tagName)) return
      const key = event.key.toLowerCase()
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(key)) {
        event.preventDefault()
        keys.current.add(key)
        targetRef.current = null
        startMovement.current()
      }
      if ((event.key === 'Enter' || event.key === ' ') && nearbyDoorRef.current) {
        event.preventDefault()
        navigate(doors[nearbyDoorRef.current].route)
      }
    }
    const onKeyUp = (event: KeyboardEvent) => keys.current.delete(event.key.toLowerCase())
    const onBlur = () => keys.current.clear()
    const resizeObserver = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(renderKitten)
    if (fieldRef.current) resizeObserver?.observe(fieldRef.current)
    renderKitten()
    syncNearbyDoor()
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      cancelAnimationFrame(frame)
      resizeObserver?.disconnect()
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [reducedMotion])

  const walkTo = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button, a')) return
    const bounds = fieldRef.current?.getBoundingClientRect()
    if (!bounds) return
    targetRef.current = {
      x: Math.max(4, Math.min(96, ((event.clientX - bounds.left) / bounds.width) * 100)),
      y: Math.max(20, Math.min(91, ((event.clientY - bounds.top) / bounds.height) * 100)),
    }
    startMovement.current()
  }

  return (
    <main className='story-screen world-screen'>
      <header className='world-header'>
        <StoryNavigation />
        <div>
          <h1>Our little world</h1>
          <p>Tap a path or use WASD / arrow keys to walk.</p>
        </div>
      </header>
      <div className='world-field' ref={fieldRef} onPointerDown={walkTo} tabIndex={0} aria-label='Walkable memory map'>
        <WorldLandscape />
        <div className='world-moon' aria-hidden='true'><span>♥</span></div>
        <div className='world-tree world-tree--one' aria-hidden='true'><i /><b /><span>♥</span></div>
        <div className='world-tree world-tree--two' aria-hidden='true'><i /><b /><span>♥</span></div>
        <div className='world-bench' aria-hidden='true'><i /><i /><span>for bobo + me</span></div>
        <div className='world-signpost' aria-hidden='true'><i /><span>movie ←</span><b>→ memories</b></div>
        <div className='world-lamp world-lamp--left' aria-hidden='true'><i /></div>
        <div className='world-lamp world-lamp--right' aria-hidden='true'><i /></div>
        <div className='world-flower-bed world-flower-bed--left' aria-hidden='true'>✿　♡　✿　♡　✿</div>
        <div className='world-flower-bed world-flower-bed--right' aria-hidden='true'>✿　♡　✿</div>

        <div className='map-building cinema-building' aria-hidden='true'>
          <div className='cinema-roof' />
          <div className='marquee'><small>NOW SHOWING</small>OUR MOVIE</div>
          <i className='building-window building-window--left' />
          <i className='building-window building-window--right' />
          <div className='ticket-booth'>TICKETS ♡</div>
        </div>
        <button className='map-door map-door--cinema' data-sound='door' type='button' aria-label='Left door cinema' onClick={() => navigate('/cinema')}>
          <span>ENTER</span><strong>CINEMA</strong>
        </button>

        <div className='map-building gallery-building' aria-hidden='true'>
          <div className='cottage-roof'><i /></div>
          <div className='cottage-heart'>♥</div>
          <i className='building-window building-window--left' />
          <i className='building-window building-window--right' />
          <div className='flower-box flower-box--left'>✿✿✿</div>
          <div className='flower-box flower-box--right'>✿✿✿</div>
        </div>
        <button className='map-door map-door--gallery' data-sound='door' type='button' aria-label='Right door memories' onClick={() => navigate('/gallery-room')}>
          <span>ENTER</span><strong>MEMORIES</strong>
        </button>

        <div
          ref={kittenRef}
          className='world-kitten'
          role='img'
          aria-label='A tiny white cat, now a proper heart-collared kitten exploring the map'
        >
          <span className='world-kitten-bob'><PixelKitten /></span>
        </div>

        {nearDoor && (
          <button className='door-prompt' type='button' onClick={() => navigate(doors[nearDoor].route)}>
            ENTER {nearDoor === 'cinema' ? 'THE CINEMA' : 'THE MEMORY ROOM'} ↵
          </button>
        )}
      </div>
    </main>
  )
}

export function CinemaPage() {
  const [mediaState, setMediaState] = useState<'loading' | 'ready' | 'missing'>('loading')
  const [playbackPrompt, setPlaybackPrompt] = useState<'sound' | 'play' | null>(null)
  const [showLilies, setShowLilies] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const video = storyContent.video

  const attemptAutoplay = async () => {
    const player = videoRef.current
    if (!player) return

    try {
      player.muted = false
      await player.play()
      setPlaybackPrompt(null)
    } catch {
      try {
        player.muted = true
        await player.play()
        setPlaybackPrompt('sound')
      } catch {
        setPlaybackPrompt('play')
      }
    }
  }

  const continueWithSound = async () => {
    const player = videoRef.current
    if (!player) return
    player.muted = false
    try {
      await player.play()
      setPlaybackPrompt(null)
    } catch {
      player.muted = true
      setPlaybackPrompt('sound')
    }
  }

  useEffect(() => () => {
    window.dispatchEvent(new Event('bobo-cinema-stop'))
  }, [])

  return (
    <main className='story-screen cinema-screen'>
      <StoryNavigation light />
      <div className='cinema-lights' aria-hidden='true'>{Array.from({ length: 12 }, (_, i) => <i key={i} />)}</div>
      <section className='cinema-stage'>
        <div className='cinema-sign'><span>NOW SHOWING</span><h1>{video.title}</h1></div>
        <div className='video-frame'>
          <video
            ref={videoRef}
            controls
            autoPlay
            playsInline
            preload='auto'
            poster={video.poster || undefined}
            src={video.src}
            onCanPlay={() => {
              setMediaState('ready')
              if (videoRef.current?.paused) void attemptAutoplay()
            }}
            onError={() => setMediaState('missing')}
            onPlay={() => {
              setShowLilies(false)
              setMediaState('ready')
              window.dispatchEvent(new Event('bobo-cinema-play'))
            }}
            onPause={() => window.dispatchEvent(new Event('bobo-cinema-stop'))}
            onEnded={() => {
              setShowLilies(true)
              window.dispatchEvent(new Event('bobo-cinema-stop'))
            }}
            onVolumeChange={() => {
              if (videoRef.current && !videoRef.current.muted) setPlaybackPrompt(null)
            }}
            aria-label={video.title}
          />
          {mediaState !== 'ready' && (
            <div className='video-placeholder'>
              <span aria-hidden='true'>▶</span>
              <h2>{mediaState === 'missing' ? 'Our movie is coming soon' : 'Preparing our movie…'}</h2>
              <p>{mediaState === 'missing' ? 'Add public/video/our-video.mp4 to start the show.' : 'Just a tiny moment…'}</p>
            </div>
          )}
          {mediaState === 'ready' && playbackPrompt && (
            <button className='cinema-audio-prompt' data-sound='soft' type='button' onClick={() => void continueWithSound()}>
              <span aria-hidden='true'>{playbackPrompt === 'sound' ? '♫' : '▶'}</span>
              {playbackPrompt === 'sound' ? 'tap to hear our movie ♡' : 'tap to start our movie ♡'}
            </button>
          )}
        </div>
        <div className='cinema-audience' aria-label='A tiny audience of two hamsters, two kittens, one duck, and two puppies'>
          {([
            ['hamster', 0],
            ['hamster', 1],
            ['kitten', 0],
            ['kitten', 1],
            ['duck', 0],
            ['puppy', 0],
            ['puppy', 1],
          ] as [CinemaAnimalKind, number][]).map(([kind, variant], index) => (
            <div className='cinema-seat' data-animal={kind} key={`${kind}-${index}`}>
              <CinemaAnimal kind={kind} variant={variant} />
              <i className='seat-chair' aria-hidden='true' />
            </div>
          ))}
        </div>
      </section>
      {showLilies && <CinemaLilyFinale />}
    </main>
  )
}

function GalleryFrame({
  photo,
  index,
  viewed,
  onOpen,
}: {
  photo: GalleryPhoto
  index: number
  viewed: boolean
  onOpen: () => void
}) {
  return (
    <button className={`gallery-frame${viewed ? ' gallery-frame--viewed' : ''}`} data-sound='select' type='button' onClick={onOpen}>
      <div><StoryImage src={photo.image} alt={photo.alt} number={index + 1} /></div>
      <span>{viewed ? 'viewed ♡' : `memory ${index + 1}`}</span>
    </button>
  )
}

export function GalleryRoomPage() {
  const photos = storyContent.galleryPhotos
  const [viewed, setViewed] = useState(() => loadStoryProgress().viewedGalleryIds)
  const [selected, setSelected] = useState<GalleryPhoto | null>(null)
  const [letterOpen, setLetterOpen] = useState(false)
  const allViewed = photos.length === 0 || photos.every((photo) => viewed.includes(photo.id))

  const openPhoto = (photo: GalleryPhoto) => {
    const progress = markGalleryPhotoViewed(photo.id)
    setViewed(progress.viewedGalleryIds)
    setSelected(photo)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelected(null)
        setLetterOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <main className='story-screen gallery-room-screen'>
      <StoryNavigation />
      <section className='gallery-room-content'>
        <div className='gallery-room-title'>
          <h1>A room full of us</h1>
          <p>{allViewed ? 'You found every memory. The letter is waiting.' : 'Open every frame to find what’s hidden here.'}</p>
        </div>
        <div className='gallery-wall'>
          {photos.length > 0 ? photos.map((photo, index) => (
            <GalleryFrame
              key={photo.id}
              photo={photo}
              index={index}
              viewed={viewed.includes(photo.id)}
              onOpen={() => openPhoto(photo)}
            />
          )) : <p className='empty-gallery-note'>No gallery photos yet—the letter is already unlocked for Bobo.</p>}
        </div>
        <button
          className={`letter-envelope${allViewed ? ' letter-envelope--unlocked' : ''}`}
          data-sound={allViewed ? 'letter' : 'soft'}
          type='button'
          disabled={!allViewed}
          onClick={() => setLetterOpen(true)}
        >
          <i aria-hidden='true'>♥</i>
          <strong>{allViewed ? 'A LETTER FOR BOBO' : `${viewed.length} / ${photos.length} MEMORIES FOUND`}</strong>
          <span>{allViewed ? 'open me' : 'still sealed'}</span>
        </button>
      </section>

      {selected && (
        <div className='story-modal' role='dialog' aria-modal='true' aria-label={selected.alt}>
          <button className='modal-close' type='button' onClick={() => setSelected(null)} aria-label='Close photo'>×</button>
          <figure className='photo-closeup'>
            <StoryImage src={selected.image} alt={selected.alt} />
            {selected.caption && <figcaption>{selected.caption}</figcaption>}
          </figure>
        </div>
      )}

      {letterOpen && (
        <div className='story-modal letter-modal' role='dialog' aria-modal='true' aria-label='A letter for Bobo'>
          <button className='modal-close' type='button' onClick={() => setLetterOpen(false)} aria-label='Close letter'>×</button>
          <article className='love-letter'>
            <div className='letter-fold' aria-hidden='true'>♡</div>
            <h2>{storyContent.letter.greeting}</h2>
            {storyContent.letter.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
            <p className='letter-signature'>{storyContent.letter.signature}</p>
          </article>
        </div>
      )}
    </main>
  )
}
