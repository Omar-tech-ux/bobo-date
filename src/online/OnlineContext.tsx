import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { activities, type DatePlan } from '../types'
import { getPlanTimes } from '../dateTime'
import {
  requestPushDelivery,
  setPendingInvitationBadge,
  showLiveInvitationNotification,
  syncExistingPushSubscription,
} from './pushNotifications'
import { isOnlineConfigured, supabase } from './supabase'
import type {
  DateInvitation,
  InvitationSendResult,
  PairingDetails,
  Profile,
  PushDeliveryResult,
} from './types'

type OnlineContextValue = {
  configured: boolean
  loading: boolean
  session: Session | null
  user: User | null
  profile: Profile | null
  pairing: PairingDetails
  receivedInvites: DateInvitation[]
  sentInvites: DateInvitation[]
  refresh: () => Promise<void>
  signOut: () => Promise<void>
  createPairCode: () => Promise<string>
  joinPairCode: (code: string) => Promise<void>
  sendInvitation: (plan: DatePlan) => Promise<InvitationSendResult>
  respondToInvitation: (
    invitationId: string,
    status: 'accepted' | 'needs_changes' | 'declined',
    note?: string,
  ) => Promise<PushDeliveryResult>
}

const emptyPairing: PairingDetails = { coupleId: null, code: null, partner: null }

const OnlineContext = createContext<OnlineContextValue | null>(null)

function readableError(error: unknown) {
  if (error instanceof Error) return error.message
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message
  }
  return 'The love-mail carrier tripped over a cloud. Please try again.'
}

export function OnlineProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(isOnlineConfigured)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [pairing, setPairing] = useState<PairingDetails>(emptyPairing)
  const [receivedInvites, setReceivedInvites] = useState<DateInvitation[]>([])
  const [sentInvites, setSentInvites] = useState<DateInvitation[]>([])

  const refresh = useCallback(async () => {
    if (!supabase) return
    const { data: currentSession } = await supabase.auth.getSession()
    const activeSession = currentSession.session
    setSession(activeSession)

    if (!activeSession?.user) {
      setProfile(null)
      setPairing(emptyPairing)
      setReceivedInvites([])
      setSentInvites([])
      setLoading(false)
      return
    }

    const userId = activeSession.user.id
    const [profileResult, pairingResult, invitesResult] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
      supabase.rpc('get_my_pairing'),
      supabase.from('date_invitations').select('*').order('created_at', { ascending: false }),
    ])

    if (profileResult.error) throw new Error(profileResult.error.message)
    if (pairingResult.error) throw new Error(pairingResult.error.message)
    if (invitesResult.error) throw new Error(invitesResult.error.message)

    setProfile(profileResult.data as Profile | null)
    const pairRow = Array.isArray(pairingResult.data) ? pairingResult.data[0] : pairingResult.data
    setPairing(
      pairRow
        ? {
            coupleId: pairRow.couple_id ?? null,
            code: pairRow.pair_code ?? null,
            partner: pairRow.partner_id
              ? {
                  id: pairRow.partner_id,
                  username: pairRow.partner_username,
                  display_name: pairRow.partner_display_name,
                }
              : null,
          }
        : emptyPairing,
    )

    const invitations = (invitesResult.data ?? []) as DateInvitation[]
    const received = invitations.filter((invite) => invite.recipient_id === userId)
    setReceivedInvites(received)
    setSentInvites(invitations.filter((invite) => invite.sender_id === userId))
    void setPendingInvitationBadge(received.filter((invite) => invite.status === 'pending').length)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!supabase) return
    void refresh().catch(() => setLoading(false))
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      window.setTimeout(() => void refresh(), 0)
    })
    return () => data.subscription.unsubscribe()
  }, [refresh])

  useEffect(() => {
    if (!session?.user) return
    void syncExistingPushSubscription(session.user.id).catch((error) => {
      console.warn('Could not refresh this device push subscription:', readableError(error))
    })
  }, [session?.user])

  useEffect(() => {
    if (!supabase || !session?.user) return
    const client = supabase
    const userId = session.user.id
    const channel = client
      .channel(`love-mail-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'date_invitations' },
        (payload) => {
          void refresh()
          const invite = payload.new as DateInvitation | undefined
          if (!invite || invite.recipient_id !== userId || payload.eventType !== 'INSERT') return
          const activity = activities.find((item) => item.id === invite.activity)
          const preview = getPlanTimes({
            date: invite.date,
            time: invite.time,
            guestTimeZone: invite.guest_timezone,
          })
          void showLiveInvitationNotification(
            'A tiny date invitation arrived ♡',
            `${activity?.label ?? 'A date'} · ${preview?.guest ?? invite.date}`,
            invite.id,
          )
        },
      )
      .subscribe()

    return () => {
      void client.removeChannel(channel)
    }
  }, [refresh, session?.user])

  const value = useMemo<OnlineContextValue>(
    () => ({
      configured: isOnlineConfigured,
      loading,
      session,
      user: session?.user ?? null,
      profile,
      pairing,
      receivedInvites,
      sentInvites,
      refresh,
      signOut: async () => {
        if (!supabase) return
        const { error } = await supabase.auth.signOut()
        if (error) throw new Error(readableError(error))
      },
      createPairCode: async () => {
        if (!supabase) throw new Error('The online mailbox is not connected yet.')
        const { data, error } = await supabase.rpc('create_pair_code')
        if (error) throw new Error(readableError(error))
        await refresh()
        return String(data)
      },
      joinPairCode: async (code) => {
        if (!supabase) throw new Error('The online mailbox is not connected yet.')
        const { error } = await supabase.rpc('join_pair_code', { submitted_code: code.trim().toUpperCase() })
        if (error) throw new Error(readableError(error))
        await refresh()
      },
      sendInvitation: async (plan) => {
        if (!supabase || !session?.user || !pairing.coupleId || !pairing.partner) {
          throw new Error('Pair your two accounts before sending this little ticket.')
        }
        const { data, error } = await supabase
          .from('date_invitations')
          .insert({
            couple_id: pairing.coupleId,
            sender_id: session.user.id,
            recipient_id: pairing.partner.id,
            date: plan.date,
            time: plan.time,
            activity: plan.activity,
            guest_timezone: plan.guestTimeZone,
            host_timezone: plan.hostTimeZone,
          })
          .select('*')
          .single()
        if (error) throw new Error(readableError(error))
        const notification = await requestPushDelivery({ invitationId: data.id, event: 'invited' })
        await refresh()
        return { invitation: data as DateInvitation, notification }
      },
      respondToInvitation: async (invitationId, status, note = '') => {
        if (!supabase || !session?.user) throw new Error('Please sign in first.')
        const { error } = await supabase
          .from('date_invitations')
          .update({
            status,
            response_note: note.trim() || null,
            responded_at: new Date().toISOString(),
          })
          .eq('id', invitationId)
          .eq('recipient_id', session.user.id)
        if (error) throw new Error(readableError(error))
        const notification = await requestPushDelivery({ invitationId, event: 'responded' })
        await refresh()
        return notification
      },
    }),
    [loading, pairing, profile, receivedInvites, refresh, sentInvites, session],
  )

  return <OnlineContext.Provider value={value}>{children}</OnlineContext.Provider>
}

export function useOnline() {
  const context = useContext(OnlineContext)
  if (!context) throw new Error('useOnline must be used inside OnlineProvider')
  return context
}
