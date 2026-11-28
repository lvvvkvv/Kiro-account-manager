interface Credentials {
  [key: string]: unknown
}
interface StoredAccount {
  credentials?: Credentials
  profileArn?: string
}

const signature = (credentials?: Credentials): string =>
  JSON.stringify([
    credentials?.accessToken,
    credentials?.refreshToken,
    credentials?.expiresAt,
    credentials?.profileArn
  ])

/** Keep a renderer's old auto-save from undoing a credential rotation performed in main. */
export class PendingAccountCredentials {
  private pending = new Map<
    string,
    { before: Set<string>; credentials: Credentials; profileArn?: string }
  >()

  record(
    id: string,
    before: Credentials | undefined,
    after: Credentials,
    profileArn?: string
  ): void {
    const previous = this.pending.get(id)
    const signatures = previous?.before || new Set<string>()
    signatures.add(signature(before))
    const credentials = Object.fromEntries(
      ['accessToken', 'refreshToken', 'expiresAt', 'profileArn']
        .filter((key) => after[key] !== undefined)
        .map((key) => [key, after[key]])
    )
    this.pending.set(id, { before: signatures, credentials, profileArn })
  }

  /** The caller validates this IPC snapshot before merging. Explicit credential edits/deletes win. */
  merge(data: unknown): void {
    const accounts = (data as { accounts: Record<string, StoredAccount> }).accounts
    for (const [id, update] of this.pending) {
      const incoming = accounts[id]
      if (incoming && update.before.has(signature(incoming.credentials))) {
        accounts[id] = {
          ...incoming,
          credentials: { ...incoming.credentials, ...update.credentials },
          ...(update.profileArn ? { profileArn: update.profileArn } : {})
        }
      } else {
        this.pending.delete(id)
      }
    }
  }

  clear(): void {
    this.pending.clear()
  }
}
