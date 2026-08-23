import {
  type CSSProperties,
  type FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  HOST_TIME_ZONE,
  detectTimeZone,
  getPlanTimes,
  getTimeZones,
  getTodayInZone,
  isValidTimeZone,
  validatePlanTime,
} from "./dateTime";
import { loadPlan, loadStoryProgress, savePlan } from "./storage";
import { activities, type ActivityId, type DatePlan } from "./types";
import {
  CinemaPage,
  GalleryRoomPage,
  MemoriesPage,
  ScrapbookPage,
  WorldPage,
} from "./story/StoryPages";
import {
  PixelDatePicker,
  PixelTimePicker,
} from "./components/PixelDateTimePickers";
import { ThemeMusic } from "./components/ThemeMusic";
import { OnlineProvider, useOnline } from "./online/OnlineContext";
import {
  AccountPage,
  InboxPage,
  InvitationPage,
  PairingPage,
} from "./online/OnlinePages";
import {
  accountRoute,
  isStoryRoute,
  navigate,
  readHashLocation,
  type HashLocation,
} from "./navigation";

const sadMessages = [
  "my heart did a tiny ouch 🥺",
  "bobo, are you suuuure?",
  "i’m getting a little sad over here…",
  "even the moon misses us now 🌙",
  "my last brave hope is the pink button",
  "okay… the YES is basically destiny now 💗",
];

function goTo(route: string) {
  navigate(route);
}

function useHashRoute() {
  const [route, setRoute] = useState<HashLocation>(() => readHashLocation());

  useEffect(() => {
    // Keep an object state so a deliberate same-hash refresh can re-check
    // local story progress after the scrapbook unlocks the world.
    const onHashChange = () => setRoute(readHashLocation());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return route;
}

export function App() {
  return (
    <OnlineProvider>
      <AppRoutes />
    </OnlineProvider>
  );
}

function AppRoutes() {
  const location = useHashRoute();
  const route = location.path;
  const { configured, loading, user } = useOnline();
  const storyUnlocked = loadStoryProgress().scrapbookCompleted;

  let page = <ProposalPage signedIn={Boolean(user)} />;
  if (route === "/terms") page = <TermsPage />;
  if (route === "/plan") page = <PlannerPage />;
  if (route === "/confirmed") page = <ConfirmationPage />;
  if (route === "/memories") page = <MemoriesPage />;
  if (route === "/scrapbook") page = <ScrapbookPage />;
  if (route === "/world") page = storyUnlocked ? <WorldPage /> : <MemoriesPage />;
  if (route === "/cinema") page = storyUnlocked ? <CinemaPage /> : <MemoriesPage />;
  if (route === "/gallery-room") page = storyUnlocked ? <GalleryRoomPage /> : <MemoriesPage />;
  if (route === "/account") page = <AccountPage />;
  if (route === "/pair") page = <PairingPage />;
  if (route === "/inbox") page = <InboxPage />;
  const invitationMatch = route.match(/^\/invite\/([^/]+)$/);
  if (invitationMatch) {
    page = (
      <InvitationPage
        invitationId={invitationMatch[1]}
        deliveryWarning={location.search.get("delivery") === "missing"}
      />
    );
  }

  if (isStoryRoute(route) && configured && !loading && !user) {
    page = <StorySignInRedirect destination={route} />;
  }

  const showMailboxShortcut = isStoryRoute(route) || route === "/terms" || route === "/confirmed";

  return <>
    <ThemeMusic route={route} />
    {showMailboxShortcut && <LoveMailboxLink />}
    {page}
  </>;
}

function StorySignInRedirect({ destination }: { destination: string }) {
  useEffect(() => goTo(accountRoute(destination)), [destination]);

  return (
    <main className='online-screen'>
      <section className='mailbox-paper mailbox-loading-paper'>
        <p className='mailbox-loading'>Opening the little sign-in gate… ♡</p>
      </section>
    </main>
  );
}

function LoveMailboxLink() {
  const { user, receivedInvites } = useOnline();
  const pendingCount = receivedInvites.filter((invite) => invite.status === "pending").length;
  return (
    <a className='love-mailbox-link' href={user ? "#/inbox" : "#/account"} aria-label='Open our love mailbox'>
      <span aria-hidden='true'>✉</span>
      {pendingCount > 0 && <b aria-label={`${pendingCount} waiting invitation${pendingCount === 1 ? "" : "s"}`}>{pendingCount}</b>}
    </a>
  );
}

function PixelScene({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`pixel-scene${compact ? " pixel-scene--compact" : ""}`}
      aria-hidden='true'
    >
      <div className='sun-pixel' />
      <div className='star star--one' />
      <div className='star star--two' />
      <div className='star star--three' />
      <div className='star star--four' />
      <div className='tiny-heart tiny-heart--one'>♥</div>
      <div className='tiny-heart tiny-heart--two'>♥</div>
      <div className='cloud cloud--one'>
        <i />
        <i />
        <i />
        <i />
      </div>
      <div className='cloud cloud--two'>
        <i />
        <i />
        <i />
        <i />
      </div>
      <div className='cloud cloud--three'>
        <i />
        <i />
        <i />
        <i />
      </div>
      <div className='far-hill far-hill--left' />
      <div className='far-hill far-hill--right' />
      <div className='city city--left'>
        <i />
        <i />
        <i />
      </div>
      <div className='city city--right'>
        <i />
        <i />
        <i />
      </div>
      <div className='near-hill near-hill--left' />
      <div className='near-hill near-hill--right' />
      <div className='distance-line'>
        <span>♥</span>
      </div>
      <div className='window window--left'>
        <i />
      </div>
      <div className='window window--right'>
        <i />
      </div>
    </div>
  );
}

function CatBadge() {
  return (
    <div className='cat-badge' aria-hidden='true'>
      <div className='cat-tail' />
      <div className='cat-body' />
      <div className='cat-head'>
        <i className='cat-ear cat-ear--left' />
        <i className='cat-ear cat-ear--right' />
        <i className='cat-eye cat-eye--left' />
        <i className='cat-eye cat-eye--right' />
        <i className='cat-mouth'>ᴗ</i>
      </div>
      <span className='cat-heart'>♥</span>
    </div>
  );
}

function Intro({ onFinish }: { onFinish: () => void }) {
  useEffect(() => {
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const timer = window.setTimeout(onFinish, reduced ? 900 : 4800);
    return () => window.clearTimeout(timer);
  }, [onFinish]);

  return (
    <section className='intro-screen' aria-label='A message for Bobo'>
      <div className='film-scratches' />
      <div className='letterbox letterbox--top' />
      <div className='letterbox letterbox--bottom' />
      <p className='intro-copy'>HI BOBO...</p>
      <p className='intro-subcopy'>I MADE A LITTLE SOMETHING FOR US</p>
      <button className='skip-intro' type='button' onClick={onFinish}>
        skip intro
      </button>
    </section>
  );
}

export function ProposalPage({ signedIn = false }: { signedIn?: boolean }) {
  const [showIntro, setShowIntro] = useState(true);
  const [noCount, setNoCount] = useState(0);
  const [celebrating, setCelebrating] = useState(false);

  const sayYes = () => {
    setCelebrating(true);
    window.setTimeout(
      () => goTo(signedIn ? "/memories" : accountRoute("/memories")),
      700,
    );
  };

  if (showIntro) return <Intro onFinish={() => setShowIntro(false)} />;

  const yesWidth = Math.min(148 + noCount * 42, 400);
  const yesHeight = Math.min(52 + noCount * 8, 104);
  const message =
    noCount > 0
      ? sadMessages[Math.min(noCount - 1, sadMessages.length - 1)]
      : "";

  return (
    <main className='app-screen proposal-screen'>
      <PixelScene />
      <section className='proposal-content'>
        <CatBadge />
        <h1>Bobo, will you go on a little long-distance date with me?</h1>
        <div className='choice-area' aria-live='polite'>
          <button
            className='pixel-button pixel-button--yes'
            data-sound='yes'
            style={
              {
                "--yes-width": `${yesWidth}px`,
                "--yes-height": `${yesHeight}px`,
              } as CSSProperties
            }
            type='button'
            onClick={sayYes}
          >
            YES! ♡
          </button>
          <div className='no-choice'>
            <button
              className='pixel-button pixel-button--no'
              data-sound='no'
              type='button'
              onClick={() => setNoCount((count) => count + 1)}
            >
              no
            </button>
            <p className='sad-message'>{message || "\u00a0"}</p>
          </div>
        </div>
        <p className='terms-note'>
          By answering, you agree to the extremely serious{" "}
          <a href='#/terms' target='_blank' rel='noopener noreferrer'>
            Terms &amp; Conditions
          </a>
          .
        </p>
        <a
          className='pixel-button proposal-mailbox-button'
          href={signedIn ? '#/inbox' : '#/account'}
        >
          <span aria-hidden='true'>✉</span>
          OPEN OUR LOVE MAILBOX
        </a>
      </section>
      {celebrating && (
        <div className='heart-burst' aria-label='Yay!'>
          {Array.from({ length: 12 }, (_, index) => (
            <i key={index}>♥</i>
          ))}
        </div>
      )}
    </main>
  );
}

function TermsPage() {
  return (
    <main className='app-screen inner-screen terms-screen'>
      <PixelScene compact />
      <article className='pixel-paper terms-paper'>
        <div className='paper-stamp'>♡</div>
        <h1>The extremely serious terms</h1>
        <p className='terms-intro'>Effective the moment Bobo presses YES.</p>
        <ol className='terms-list'>
          <li>
            <strong>Unlimited affection.</strong> Hugs are owed across every
            mile and will be collected later.
          </li>
          <li>
            <strong>Calls may run long.</strong> “Five more minutes” can legally
            become another hour.
          </li>
          <li>
            <strong>Teasing is permitted.</strong> It must remain cute, gentle,
            and followed by reassurance.
          </li>
          <li>
            <strong>Plans can change.</strong> Either person can reschedule at
            any time—no guilt, no pressure.
          </li>
          <li>
            <strong>Comfort comes first.</strong> A YES here is only for one
            sweet date. Boundaries and consent always matter.
          </li>
          <li>
            <strong>Distance loses.</strong> We still get to make tiny memories
            together, wherever we are.
          </li>
          <li>
            <strong>Over all pics.</strong> You get to send me a picture of you
            everywhere you go! and thow me your feet everytime we call for the
            next 1 to 2 months duh...
          </li>
        </ol>
        <p className='signature'>
          Signed with a ridiculous amount of love,
          <br />
          <span>your favorite person Howsmichu from instagram ♡</span>
        </p>
        <a className='text-link' href='#/'>
          return to the important question
        </a>
      </article>
    </main>
  );
}

export function PlannerPage() {
  const { configured, user, pairing, sendInvitation } = useOnline();
  const previous = loadPlan();
  const detectedZone = previous?.guestTimeZone ?? detectTimeZone();
  const [date, setDate] = useState(previous?.date ?? "");
  const [time, setTime] = useState(previous?.time ?? "");
  const [activity, setActivity] = useState<ActivityId | "">(
    previous?.activity ?? "",
  );
  const [guestTimeZone, setGuestTimeZone] = useState(detectedZone);
  const [error, setError] = useState("");
  const [errorField, setErrorField] = useState<
    "all" | "date" | "time" | "activity" | "timezone" | "schedule" | null
  >(null);
  const [validationAttempt, setValidationAttempt] = useState(0);
  const [sending, setSending] = useState(false);
  const zones = useMemo(() => getTimeZones(detectedZone), [detectedZone]);
  const preview = useMemo(
    () => getPlanTimes({ date, time, guestTimeZone }),
    [date, time, guestTimeZone],
  );

  const submitPlan = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setValidationAttempt((attempt) => attempt + 1);

    if (!date && !time && !activity) {
      setError(
        "Bobo… you left the whole date in mystery mode 😭 Pick a day, a time, and one tiny adventure for us ♡",
      );
      setErrorField("all");
      return;
    }
    if (!date && !time) {
      setError(
        "The adventure is cute, but WHEN are we doing it, time traveler? 🗓️⏰",
      );
      setErrorField("schedule");
      return;
    }
    if (!date) {
      setError("Our date needs an actual date, silly goose 🗓️♡");
      setErrorField("date");
      return;
    }
    if (!time) {
      setError("What time should I start missing you extra? ⏰🥺");
      setErrorField("time");
      return;
    }
    if (!activity) {
      setError("Pick our tiny adventure—my popcorn is getting nervous 🍿💗");
      setErrorField("activity");
      return;
    }
    if (!isValidTimeZone(guestTimeZone)) {
      setError("Your timezone wandered off without us 🥺 Pick it from the list.");
      setErrorField("timezone");
      return;
    }
    const timeError = validatePlanTime(date, time, guestTimeZone);
    if (timeError) {
      setError(timeError);
      setErrorField("schedule");
      return;
    }

    const plan: DatePlan = {
      date,
      time,
      activity,
      guestTimeZone,
      hostTimeZone: HOST_TIME_ZONE,
      createdAt: new Date().toISOString(),
    };
    savePlan(plan);

    if (!configured) {
      goTo("/confirmed");
      return;
    }
    if (!user) {
      setError("This ticket needs a sender, cutie ♡ Sign in to your love mailbox, then come right back—your choices are saved.");
      setErrorField(null);
      return;
    }
    if (!pairing.partner) {
      setError("Your ticket needs its one special recipient ♡ Pair your two accounts first, then come right back.");
      setErrorField(null);
      return;
    }

    setSending(true);
    try {
      const result = await sendInvitation(plan);
      const deliveryMissing = result.notification.accepted < 1;
      goTo(`/invite/${result.invitation.id}${deliveryMissing ? "?delivery=missing" : ""}`);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Our tiny mail carrier got lost. Please try once more.");
      setErrorField(null);
    } finally {
      setSending(false);
    }
  };

  return (
    <main className='app-screen inner-screen planner-screen'>
      <PixelScene compact />
      <section className='pixel-paper planner-paper'>
        <div className='planner-heading'>
          <span className='mini-envelope' aria-hidden='true'>
            ♥
          </span>
          <div>
            <h1>Let’s pick our little date</h1>
            <p>You choose the moment. I’ll meet you from Amman.</p>
          </div>
        </div>

        <form onSubmit={submitPlan} noValidate>
          <div className='date-row'>
            <div
              className={
                errorField === "all" ||
                errorField === "date" ||
                errorField === "schedule"
                  ? "field-has-error"
                  : undefined
              }
            >
              <PixelDatePicker
                value={date}
                min={getTodayInZone(guestTimeZone)}
                invalid={
                  errorField === "all" ||
                  errorField === "date" ||
                  errorField === "schedule"
                }
                describedBy={error ? "planner-error" : undefined}
                onChange={(nextDate) => {
                  setDate(nextDate);
                  setError("");
                  setErrorField(null);
                }}
              />
            </div>
            <div
              className={
                errorField === "all" ||
                errorField === "time" ||
                errorField === "schedule"
                  ? "field-has-error"
                  : undefined
              }
            >
              <PixelTimePicker
                value={time}
                invalid={
                  errorField === "all" ||
                  errorField === "time" ||
                  errorField === "schedule"
                }
                describedBy={error ? "planner-error" : undefined}
                onChange={(nextTime) => {
                  setTime(nextTime);
                  setError("");
                  setErrorField(null);
                }}
              />
            </div>
          </div>

          <fieldset
            className={`activity-fieldset${
              errorField === "all" || errorField === "activity"
                ? " activity-fieldset--error"
                : ""
            }`}
            aria-invalid={errorField === "all" || errorField === "activity"}
            aria-describedby={error ? "planner-error" : undefined}
          >
            <legend>What should we do?</legend>
            <div className='activity-grid'>
              {activities.map((item) => (
                <label className='activity-option' data-sound='select' key={item.id}>
                  <input
                    type='radio'
                    name='activity'
                    value={item.id}
                    checked={activity === item.id}
                    onChange={() => {
                      setActivity(item.id);
                      setError("");
                      setErrorField(null);
                    }}
                  />
                  <span aria-hidden='true'>{item.icon}</span>
                  {item.label}
                </label>
              ))}
            </div>
          </fieldset>

          <label
            className={`timezone-label${
              errorField === "timezone" ? " field-has-error" : ""
            }`}
          >
            Your timezone
            <input
              type='text'
              required
              aria-invalid={errorField === "timezone"}
              aria-describedby={error ? "planner-error" : undefined}
              list='timezones'
              value={guestTimeZone}
              onChange={(event) => {
                setGuestTimeZone(event.target.value);
                setError("");
                setErrorField(null);
              }}
              spellCheck='false'
              autoComplete='off'
            />
          </label>
          <datalist id='timezones'>
            {zones.map((zone) => (
              <option key={zone} value={zone} />
            ))}
          </datalist>

          <div className='time-preview' aria-live='polite'>
            <div>
              <span className='preview-icon'>☾</span>
              <p>Your side</p>
              <strong>{preview?.guest ?? "Choose a day & time"}</strong>
            </div>
            <div className='preview-heart' aria-hidden='true'>
              ··· ♥ ···
            </div>
            <div>
              <span className='preview-icon'>☀</span>
              <p>My side · Amman</p>
              <strong>{preview?.host ?? "I’ll be right here"}</strong>
            </div>
          </div>

          {configured && (
            <div className='ticket-recipient'>
              <span aria-hidden='true'>✉</span>
              {pairing.partner ? (
                <p>This ticket will fly only to <strong>{pairing.partner.display_name}</strong> (@{pairing.partner.username}).</p>
              ) : user ? (
                <p><a href='#/pair'>Pair your accounts</a> so this ticket knows where to fly.</p>
              ) : (
                <p><a href='#/account'>Sign in or make your account</a> before locking in the date.</p>
              )}
            </div>
          )}

          {error && (
            <div
              className='cute-validation'
              id='planner-error'
              role='alert'
              key={validationAttempt}
            >
              <span className='validation-cat' aria-hidden='true'>/ᐠ｡ꞈ｡ᐟ\\</span>
              <p>{error}</p>
            </div>
          )}
          <button className='pixel-button lock-button' data-sound='confirm' type='submit' disabled={sending}>
            {sending ? "SENDING YOUR TICKET…" : configured ? "SEND OUR DATE INVITE ♥" : "LOCK IN OUR DATE ♥"}
          </button>
        </form>
      </section>
    </main>
  );
}

function ConfirmationPage() {
  const plan = loadPlan();
  const storyUnlocked = loadStoryProgress().scrapbookCompleted;

  if (!plan) {
    return (
      <main className='app-screen inner-screen empty-confirmation'>
        <PixelScene compact />
        <section className='pixel-paper confirmation-paper'>
          <h1>Our ticket is still blank</h1>
          <p>Let’s pick a date first, Bobo.</p>
          <a className='pixel-button link-button' href='#/inbox'>
            OPEN OUR LOVE MAILBOX
          </a>
        </section>
      </main>
    );
  }

  const chosenActivity = activities.find((item) => item.id === plan.activity);
  const times = getPlanTimes(plan);

  return (
    <main className='app-screen inner-screen confirmation-screen'>
      <PixelScene compact />
      <section className='confirmation-wrap'>
        <p className='yay-copy'>IT’S A DATE!</p>
        <article className='date-ticket'>
          <div className='ticket-top'>
            <span>{chosenActivity?.icon}</span>
            <div>
              <h1>{chosenActivity?.label}</h1>
              <p>admit two very cute people</p>
            </div>
          </div>
          <div className='ticket-times'>
            <div>
              <span>Bobo’s time</span>
              <strong>{times?.guest}</strong>
            </div>
            <div>
              <span>Amman time</span>
              <strong>{times?.host}</strong>
            </div>
          </div>
          <p className='ticket-note'>
            No matter the miles, I can’t wait to spend this little moment with
            you. ♡
          </p>
          <div className='ticket-number'>
            BOBO—{plan.date.replaceAll("-", "")}
          </div>
        </article>
        <div className='confirmation-actions'>
          <a href='#/memories' className='pixel-button link-button story-button'>
            {storyUnlocked ? 'VISIT OUR LITTLE WORLD ᨒ' : 'OPEN OUR SCRAPBOOK ♡'}
          </a>
          <a href='#/inbox' className='text-link change-plan-link'>
            open our love mailbox
          </a>
          <a href='#/' className='text-link replay-link'>
            replay from the beginning
          </a>
        </div>
      </section>
      <div className='ambient-hearts' aria-hidden='true'>
        {Array.from({ length: 9 }, (_, index) => (
          <i key={index}>♥</i>
        ))}
      </div>
    </main>
  );
}
