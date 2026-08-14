# Adding your memories

All personal content is controlled from `src/content/storyContent.ts`.

## Scrapbook photos

1. Put photo files in `public/memories/`.
2. Set a memory's image value to its public path, for example:

```ts
image: './memories/first-call.jpg'
```

Each memory accepts an image, accessible description, optional date label, and caption. Add or remove memory objects freely.

## Gallery photos

1. Put photo files in `public/gallery/`.
2. Set each gallery item's image value, for example:

```ts
image: './gallery/favorite-selfie.jpg'
```

The letter unlocks after every configured gallery photo has been opened.

## Video

Place an MP4 file at `public/video/our-video.mp4`. To use a different filename, update `storyContent.video.src`. The video never autoplays.

## Letter

Edit `storyContent.letter`. Each item in `paragraphs` becomes its own paragraph. Use `\n` inside the signature for a line break.

If a file path is empty or a file cannot load, the app shows a styled placeholder instead of a broken image or video.
