# Overriding Framework Adapters

Every adapter in `@wayfinder/adapters` implements an interface from
`@wayfinder/domain`. Because the contract is the interface — not the
implementation — you can override any adapter without touching framework code.

There are four levels, from least to most invasive:

---

## Level 1 — Configuration (zero code change)

Most adapters accept a config object. Pass custom options at construction time
in `lib/container.ts`:

```typescript
// apps/web/src/lib/container.ts
import { createAdapters } from "@wayfinder/adapters";

const adapters = createAdapters(db, {
  aiProvider: "openai",      // switch from the default provider
  langfuse: {
    publicKey: env.LANGFUSE_PUBLIC_KEY,
    secretKey: env.LANGFUSE_SECRET_KEY,
  },
  nodeEnv: env.NODE_ENV,
});
```

---

## Level 2 — Swap (implement the port yourself)

Because every adapter implements a `I*` interface from `@wayfinder/domain`,
any piece can be replaced by passing an alternative to `createAdapters`:

```typescript
import type { IUserRepository } from "@wayfinder/domain";

class MyUserRepository implements IUserRepository {
  // custom implementation — e.g. backed by a different DB, or cached
}

const adapters = createAdapters(db, {
  aiProvider: "anthropic",
  overrides: {
    userRepo: new MyUserRepository(),
  },
});
```

The rest of the application never knows the difference — use cases receive the
same interface regardless of which implementation is wired.

---

## Level 3 — Extend (subclass the published adapter)

When you want the base behaviour plus additions:

```typescript
import { DrizzleUserRepository } from "@wayfinder/adapters/repositories";

class CachingUserRepository extends DrizzleUserRepository {
  private cache = new Map<string, User>();

  async findById(id: string): Promise<Result<User>> {
    if (this.cache.has(id)) return ok(this.cache.get(id)!);
    const result = await super.findById(id);
    if (!result.error) this.cache.set(id, result.data);
    return result;
  }
}
```

Pass the subclass via `overrides.userRepo`.

---

## Level 4 — Eject (copy source, stop receiving updates)

For rare cases where the published implementation is fundamentally wrong for
your use case. Copy the source file into your project manually:

```bash
# Copy the adapter source
cp packages/adapters/src/repositories/drizzle-user-repository.ts \
   packages/adapters/src/repositories/my-user-repository.ts

# Update the import in container.ts
```

The copy is now a separate adapter that no longer tracks changes to the one it
was taken from — a fix to `drizzle-user-repository.ts` will not reach it.

---

## Which level should I use?

| Situation | Level |
|---|---|
| Just want a different AI provider or config value | 1 — Configuration |
| Need completely different storage/vendor | 2 — Swap |
| Want base behaviour + extra logic | 3 — Extend |
| Framework implementation is architecturally incompatible | 4 — Eject |

Start at Level 1 and only move up when you have to.
