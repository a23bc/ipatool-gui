import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { LoginResult, LoginStatus } from '@shared/types'
import { useAppStore } from '@renderer/store/app'
import { refreshChromeDimming, useUiStore } from '@renderer/store/ui'
import { ErrorNotice } from '@renderer/components/ErrorNotice'
import { Icon, Spinner } from '@renderer/components/Icon'
import { Modal } from '@renderer/components/Modal'

type Step = 'credentials' | 'code'

/** Maps an ipatool login outcome onto a translated error code. */
function codeForStatus(status: LoginStatus): string | null {
  switch (status) {
    case 'needs-2fa':
      return 'two-factor-required'
    case 'passphrase-required':
      return 'passphrase-required'
    case 'bad-credentials':
      return 'bad-credentials'
    case 'rate-limited':
      return 'rate-limited'
    default:
      return null
  }
}

export function AuthModal(): ReactNode {
  const t = useAppStore((state) => state.t)
  const account = useAppStore((state) => state.account)
  const accounts = useAppStore((state) => state.accounts)
  const settings = useAppStore((state) => state.settings)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const refreshAccount = useAppStore((state) => state.refreshAccount)
  const revokeAccount = useAppStore((state) => state.revokeAccount)

  const open = useUiStore((state) => state.authOpen)
  const setOpen = useUiStore((state) => state.setAuthOpen)
  const setAccountsOpen = useUiStore((state) => state.setAccountsOpen)
  const toast = useUiStore((state) => state.toast)
  const setView = useUiStore((state) => state.setView)

  // The sign-in is bound to whichever account is active: ipatool selects its
  // session purely by environment, so an unbound login would land in whatever
  // directory happened to be current.
  //
  // `target` is undefined for a never-used slot, which the registry keeps out of
  // the list - and that is precisely the first-ever sign-in, where a generic
  // subtitle fits better than naming an account the user has not created yet.
  const targetId = accounts.activeId
  const target = accounts.accounts.find((view) => view.id === targetId)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<Step>('credentials')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<{ message: string; code: string | null } | null>(null)
  const [checking, setChecking] = useState(false)
  const [showEmails, setShowEmails] = useState(false)
  const emailBoxRef = useRef<HTMLDivElement>(null)

  // Reset transient state each time the dialog opens - and scrub the password
  // the moment it closes. The dialog stays mounted while hidden (Modal returns
  // null but this component lives on), so without the close branch the typed
  // password would linger in React state until the next open.
  useEffect(() => {
    if (!open) {
      setPassword('')
      setCode('')
      setShowEmails(false)
      return
    }
    setStep('credentials')
    setEmail('')
    setPassword('')
    setCode('')
    setFailure(null)
    setBusy(false)
    setShowEmails(false)
  }, [open])

  // The custom suggestion panel is outside the input, so close it on an
  // outside click instead of relying on input blur (clicking Delete would
  // otherwise close the list before the click lands).
  useEffect(() => {
    if (!showEmails) return
    const onMouseDown = (event: MouseEvent): void => {
      if (!emailBoxRef.current?.contains(event.target as Node)) setShowEmails(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [showEmails])

  const forgetEmail = async (value: string): Promise<void> => {
    await updateSettings({
      emailHistory: settings.emailHistory.filter((entry) => entry !== value)
    })
  }

  const submit = async (): Promise<void> => {
    if (busy) return
    if (email.trim() === '' || password === '') return

    setBusy(true)
    setFailure(null)

    let result: LoginResult
    try {
      result = await window.api.login(
        email.trim(),
        password,
        step === 'code' ? code.trim() : undefined,
        targetId
      )
    } catch (error) {
      // The bridge itself failed (main crashed, invoke rejected): roll the UI
      // back instead of leaving the dialog spinning forever. The password is
      // kept - an infrastructure failure says nothing about the credentials, and
      // making the user retype them is the one thing that cannot be recovered.
      setFailure({ message: String(error), code: null })
      setCode('')
      setStep('credentials')
      return
    } finally {
      setBusy(false)
      // Login runs through ipatool and can leave the OS caption strip repainted;
      // the dialog is still open, so restore its transparent overlay.
      refreshChromeDimming()
    }

    if (result.status === 'ok') {
      useAppStore.setState({ pendingAddRestoreId: null })
      const signedInEmail = email.trim()
      await updateSettings({
        emailHistory: [
          signedInEmail,
          ...settings.emailHistory.filter(
            (entry) => entry.toLowerCase() !== signedInEmail.toLowerCase()
          )
        ].slice(0, 50)
      })
      useAppStore.getState().setAccount(result.account)
      setOpen(false)
      toast({ kind: 'success', message: t('auth.success', { email: result.account?.email ?? email }) })
      setPassword('')
      setCode('')
      return
    }

    if (result.status === 'needs-2fa' && step === 'credentials') {
      setStep('code')
      return
    }

    setFailure({ message: result.message, code: codeForStatus(result.status) })
    if (result.status === 'needs-2fa') {
      // Wrong/expired code: the flow continues at the code step, so keep the
      // verified password and only reset the code field.
      setCode('')
    } else {
      // A failed attempt keeps both fields: re-entering a long Apple ID password
      // after a typo'd 2FA code or a transient rate-limit is the worst part of the
      // flow, and the value never left this process. (Revisiting whether the
      // password should survive is tracked separately.)
      setCode('')
      setStep('credentials')
    }
  }

  const recheck = async (): Promise<void> => {
    setChecking(true)
    try {
      const info = await refreshAccount(targetId)
      toast(
        info
          ? { kind: 'success', message: t('auth.success', { email: info.email }) }
          : { kind: 'warn', message: t('auth.signedOut') }
      )
    } catch (error) {
      toast({ kind: 'error', message: String(error) })
    } finally {
      setChecking(false)
    }
  }

  return (
    <Modal
      open={open}
      title={step === 'code' ? t('auth.2fa.title') : account ? t('auth.account.title') : t('auth.title')}
      subtitle={
        step === 'code'
          ? t('auth.2fa.body')
          : account
            ? undefined
            : target
              ? t('auth.subtitleNew', { name: target.name })
              : t('auth.subtitle')
      }
      onClose={() => {
        setOpen(false)
        void useAppStore.getState().restoreAccountAfterAuthClose()
      }}
      width={440}
      footer={
        step === 'code' ? (
          <>
            <button type="button" className="btn" onClick={() => setStep('credentials')} disabled={busy}>
              {t('auth.2fa.resend')}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void submit()}
              disabled={busy || code.trim().length < 4}
            >
              {busy ? <Spinner size={13} /> : null}
              {t('auth.2fa.submit')}
            </button>
          </>
        ) : account ? (
          <>
            <button type="button" className="btn" onClick={() => void recheck()} disabled={checking}>
              {checking ? <Spinner size={13} /> : <Icon name="refresh" size={13} />}
              {t('auth.account.refresh')}
            </button>
            <button type="button" className="btn" onClick={() => setAccountsOpen(true)}>
              <Icon name="user" size={13} />
              {t('accounts.manage')}
            </button>
            <button type="button" className="btn btn-danger" onClick={() => void revokeAccount(targetId)}>
              {t('auth.signOut')}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setOpen(false)
                void useAppStore.getState().restoreAccountAfterAuthClose()
              }}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void submit()}
              disabled={busy || email.trim() === '' || password === ''}
            >
              {busy ? <Spinner size={13} /> : null}
              {busy ? t('auth.signingIn') : t('auth.submit')}
            </button>
          </>
        )
      }
    >
      {account && step === 'credentials' ? (
        <dl className="flex flex-col gap-2.5 text-[12.5px]">
          <div className="flex items-center justify-between gap-3">
            <dt className="dim">{t('auth.account.name')}</dt>
            <dd className="truncate font-medium">{account.name || '—'}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="dim">{t('auth.account.email')}</dt>
            <dd className="mono truncate">{account.email}</dd>
          </div>
          <div className="divider my-1" />
          <p className="text-[11.5px] leading-relaxed faint">{t('auth.revoke.body')}</p>
        </dl>
      ) : null}

      {!account || step === 'code' ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          {step === 'credentials' ? (
            <>
              {/* A div, not a label: clicking a suggestion inside a label would
                  re-focus the input and immediately reopen the list. */}
              <div className="flex flex-col gap-1.5">
                <span className="text-[11.5px] font-medium dim">{t('auth.email')}</span>
                <div ref={emailBoxRef} className="relative">
                  <input
                    className="input"
                    // Apple IDs are often phone numbers (e.g. +86…). `type="email"`
                    // makes the browser reject those before ipatool ever sees them.
                    type="text"
                    value={email}
                    autoComplete="off"
                    aria-label={t('auth.email')}
                    placeholder={t('auth.emailPlaceholder')}
                    role="combobox"
                    aria-expanded={showEmails && settings.emailHistory.length > 0}
                    aria-controls="auth-email-history"
                    aria-autocomplete="list"
                    onChange={(event) => {
                      setEmail(event.target.value)
                      if (settings.emailHistory.length > 0) setShowEmails(true)
                    }}
                    onFocus={() => {
                      if (settings.emailHistory.length > 0) setShowEmails(true)
                    }}
                    onClick={() => {
                      if (settings.emailHistory.length > 0) setShowEmails(true)
                    }}
                    disabled={busy}
                  />
                  {showEmails && settings.emailHistory.length > 0 ? (
                    <div
                      id="auth-email-history"
                      role="listbox"
                      className="absolute left-0 right-0 top-full z-20 mt-1 max-h-[176px] overflow-y-auto rounded-lg border p-1"
                      style={{
                        background: 'var(--bg-elev)',
                        borderColor: 'var(--border)',
                        boxShadow: 'var(--shadow)'
                      }}
                    >
                      {settings.emailHistory.map((value) => (
                        <div
                          key={value}
                          className="group flex h-8 items-center rounded px-2 hover:bg-[var(--row-hover)]"
                        >
                          <button
                            type="button"
                            role="option"
                            aria-selected={value === email}
                            className="mono min-w-0 flex-1 truncate text-left text-[12px]"
                            onClick={() => {
                              setEmail(value)
                              setShowEmails(false)
                            }}
                          >
                            {value}
                          </button>
                          <button
                            type="button"
                            className="ml-2 flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--text-faint)] opacity-0 transition-opacity hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] focus:opacity-100 group-hover:opacity-100"
                            aria-label={t('auth.emailHistoryDelete')}
                            title={t('auth.emailHistoryDelete')}
                            onClick={() => void forgetEmail(value)}
                          >
                            <Icon name="trash" size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>

              <label className="flex flex-col gap-1.5">
                <span className="text-[11.5px] font-medium dim">{t('auth.password')}</span>
                <input
                  className="input"
                  type="password"
                  value={password}
                  autoComplete="current-password"
                  placeholder={t('auth.passwordPlaceholder')}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={busy}
                />
              </label>

              <p className="text-[11.5px] leading-relaxed faint">{t('auth.slow')}</p>
            </>
          ) : (
            <label className="flex flex-col gap-1.5">
              <span className="text-[11.5px] font-medium dim">{t('auth.2fa.placeholder')}</span>
              <input
                className="input input-mono text-center text-[16px] tracking-[0.4em]"
                value={code}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={8}
                placeholder="······"
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
                disabled={busy}
              />
            </label>
          )}

          {failure ? (
            // No retry affordance: the failed attempt already left every field
            // intact, so the button could only re-send what the user is about to
            // edit anyway - and on a rate limit it invites a retry that cannot
            // succeed.
            <ErrorNotice message={failure.message} hint={failure.code} onViewLog={undefined} />
          ) : null}

          {failure?.code === 'passphrase-required' ? (
            <button
              type="button"
              className="btn h-[26px] self-start"
              onClick={() => {
                setOpen(false)
                setView('settings')
              }}
            >
              <Icon name="settings" size={13} />
              {t('settings.section.account')}
            </button>
          ) : null}
        </form>
      ) : null}
    </Modal>
  )
}
