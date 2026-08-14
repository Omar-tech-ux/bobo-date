export type MemoryPage = {
  id: string;
  image: string;
  alt: string;
  objectPosition?: string;
  date?: string;
  caption: string;
};

export type GalleryPhoto = {
  id: string;
  image: string;
  alt: string;
  caption?: string;
};

export type StoryContent = {
  memories: MemoryPage[];
  galleryPhotos: GalleryPhoto[];
  video: {
    src: string;
    poster?: string;
    title: string;
  };
  letter: {
    greeting: string;
    paragraphs: string[];
    signature: string;
  };
};

// Replace the empty image paths with files from /public/memories and
// /public/gallery. See CONTENT_GUIDE.md for copy-and-paste examples.
export const storyContent: StoryContent = {
  memories: [
    {
      id: "the-beginning",
      image: "./memories/IMG-1.JPG",
      alt: "Add a photo from the beginning of your story",
      date: "THE BEGINNING",
      caption: "The little moment that quietly started everything.",
    },
    {
      id: "favorite-laugh",
      image: "./memories/IMG-2.jpeg",
      alt: "Add a favorite happy photo together",
      date: "A VERY GOOD DAY",
      caption: "One of the many times you made the whole world feel lighter.",
    },
    {
      id: "across-the-miles",
      image: "./memories/IMG-3.JPG",
      alt: "Add a long-distance memory",
      date: "ACROSS THE MILES",
      caption: "Still us, still close, even when the map says otherwise.",
    },
    {
      id: "little-things",
      image: "./memories/IMG-4.JPG",
      alt: "Add a photo of one of the little things you love about her",
      date: "THE LITTLE THINGS",
      caption: "The tiny things you do somehow become my favorite memories.",
    },
    {
      id: "late-night-calls",
      image: "./memories/IMG-5.JPG",
      alt: "Add a photo from one of your late-night calls",
      objectPosition: "center top",
      date: "PAST OUR BEDTIME",
      caption: "One more minute with you always turns into a whole extra hour.",
    },
    {
      id: "favorite-smile",
      image: "./memories/IMG-6.JPG",
      alt: "Add a photo of her favorite smile",
      date: "THAT SMILE",
      caption: "The kind of smile I would cross every mile to see.",
    },
    {
      id: "ordinary-magic",
      image: "./memories/IMG-7.jpeg",
      alt: "Add a photo of an ordinary moment that felt special",
      date: "OUR EVERYDAY MAGIC",
      caption: "Nothing fancy—just us making an ordinary moment feel special.",
    },
    {
      id: "missing-you",
      image: "./memories/IMG-8.jpeg",
      alt: "Add a photo that reminds you the distance is worth it",
      objectPosition: "center 72%",
      date: "WORTH THE WAIT",
      caption: "Missing you is hard, but loving you makes every mile worth it.",
    },
    {
      id: "next-chapter",
      image: "./memories/IMG-9.JPG",
      alt: "Add a photo that feels like a preview of your future together",
      date: "SOMEDAY SOON",
      caption:
        "A little preview of all the memories we still get to make side by side.",
    },
    {
      id: "more-to-come",
      image: "./memories/IMG-10.JPG",
      alt: "Add a photo that makes you excited for the future",
      date: "TO BE CONTINUED…",
      caption:
        "My favorite part is knowing there are more pages waiting for us.",
    },
  ],
  galleryPhotos: [
    {
      id: "gallery-one",
      image: "./gallery/IMG-1-2026.JPG",
      alt: "Add the first gallery photo",
      caption: "A tiny piece of us. 14-6-2026",
    },
    {
      id: "gallery-two",
      image: "./gallery/IMG-3-2026.JPG",
      alt: "Add the second gallery photo",
      caption: "A Pic is worth a thousand words. 14-6-2026",
    },
    {
      id: "gallery-three",
      image: "./gallery/IMG-2-2024.JPG",
      alt: "Add the third gallery photo",
      caption: "A smile worth keeping forever. 14-6-2024",
    },
  ],
  video: {
    src: "./video/our-video.mp4",
    title: "Our little movie",
  },
  letter: {
    greeting: "My Bobo,",
    paragraphs: [
      "I love you so much and i wish you nothing but the best, i miss you and i cant wait to see you again, i hope you are doing well and that you are happy, i hope you are taking care of yourself and that you are not too stressed out, i hope you are eating well and sleeping well, i hope you are enjoying your time and that you are having fun, i hope you are feeling loved and appreciated and that you know how much you mean to me.",
      "Everytime i think you i feel happier, i feel like i must push forward to get to live with the person i want to spend the rest of my life with, i feel like i must work harder to make sure that we can be together and that we can have a future together, i feel like i must be the best version of myself for you and for us, i feel like i must be strong and patient and understanding and loving and kind and supportive and caring and thoughtful and generous and loyal and faithful and honest and trustworthy and respectful and considerate.",
      "I'm sure this whole long distance thing won't last any longer, and once the distance between us is gone, i cant wait to spend my time with you and hold you tight, I LOVE YOU BOBO. MWAHHHHHHH <3",
    ],
    signature: "Always yours,\nHowsmichu ♡",
  },
};
