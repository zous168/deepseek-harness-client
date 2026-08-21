/**
 * Web boot kernel. It owns only the module system, Cordis loader, and a
 * framework-free boot page. The dynamic UI renderer receives the mount
 * point after `immediately` shell entries activate; a later roster failure
 * is logged and does not withhold the mount.
 * @module @deepseek-ai/dsh-client-web/src/boot
 */
import { Context } from '@deepseek-ai/cordis'
import Loader, { type Entry } from '@deepseek-ai/cordis-plugin-loader'
import type {
  BootManifest, ClientModuleCreateOptions, ClientModuleSystem, DshWindow,
} from '@deepseek-ai/dsh-client-modules/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { BootPage } from './boot-page.ts'
import { getStaticModules } from './seed.ts'
import { STATE_LABELS } from './loader-status.ts'
import './base.css'

/** Module transport hook replaced by jsdom tests. */
export type BootSeams = Pick<ClientModuleCreateOptions, 'loadBundle'>

/** Browser boot entry consumed by `apps/web`. */
export class AppWebEntry {
  private readonly container: HTMLElement
  private readonly seams: BootSeams | undefined
  private readonly page: BootPage
  private ctx: Context | undefined
  private modules!: ClientModuleSystem
  private manifest!: BootManifest

  /**
   * Draw the boot page; {@link run} starts the loader.
   * @param container - Application mount point.
   * @param seams - Optional module transport replacement.
   */
  constructor(container: HTMLElement, seams?: BootSeams) {
    this.container = container
    this.seams = seams
    this.page = new BootPage(container)
  }

  /**
   * Load and activate every client entry, then hand the mount point to the
   * UI renderer. An `immediately` entry that fails stays on the boot page.
   * A later roster entry that fails is logged; the application still mounts.
   * @returns Resolves after application mount or failure rendering.
   */
  async run(): Promise<void> {
    try {
      const win = globalThis as DshWindow
      const moduleLoader = win.__ModuleLoader__
      if (moduleLoader === undefined) {
        throw new Error('web boot: window.__ModuleLoader__ bootstrap facade is missing')
      }
      this.modules = moduleLoader.create({
        boot: win.__DSH_BOOT__,
        staticModules: getStaticModules(),
        ...this.seams,
      })
      this.manifest = this.modules.manifest

      const prefetching = this.prefetchImmediateTier()
      const ctx = new Context()
      this.ctx = ctx
      await this.runPluginBoot(ctx, prefetching)
      await this.mountApp(ctx)
    } catch (reason) {
      console.error(reason)
      this.page.fail(reason instanceof Error ? reason.message : String(reason))
    }
  }

  /** Dispose the client plugin tree and whichever page owns the mount point. */
  async dispose(): Promise<void> {
    const ctx = this.ctx
    this.ctx = undefined
    if (ctx !== undefined) await ctx.fiber.dispose()
    this.page.dispose()
  }

  /** Mount through a dependency fiber so replacing uiRenderer remounts the application. */
  private async mountApp(ctx: Context): Promise<void> {
    const mounted = ctx.inject(['uiRenderer'], (scope) => {
      scope.effect(() => scope.uiRenderer.mount(this.container), 'web boot: application mount')
    })
    await mounted
  }

  /** Prefetch stage-one bundles; their import path owns any eventual failure. */
  private async prefetchImmediateTier(): Promise<void> {
    await Promise.all(this.manifest.plugins
      .filter(row => row.immediately)
      .map(row => this.modules.prefetch(row.id).catch((_prefetchError: unknown) => {
        // Prefetch only starts transport early; the Loader import retries and reports this bundle failure.
      })))
  }

  /** Mount the Loader, create all graph entries, await quiescence, and audit activation. */
  private async runPluginBoot(ctx: Context, prefetching: Promise<void>): Promise<void> {
    await ctx.plugin(Loader)
    const loader = ctx.loader
    loader.internal = this.modules as never

    ctx.on('internal/status', (fiber) => {
      const entry = fiber.entry
      if (entry === undefined || entry.fiber === undefined) return
      this.page.setState(entry.options.name, STATE_LABELS[entry.fiber.state])
    })

    const rows = this.manifest.plugins.map(row => row.id)
    const required = new Set(this.manifest.plugins.filter(row => row.immediately).map(row => row.id))
    this.page.setTotal(rows.length)
    await prefetching
    await Promise.all(rows.map(async (name) => {
      this.page.setState(name, 'loading')
      try {
        const id = await loader.create({ name })
        if (loader.resolve(id).fiber === undefined && required.has(name)) this.page.setState(name, 'failed')
      } catch (error: unknown) {
        console.error(error)
        if (required.has(name)) this.page.setState(name, 'failed')
      }
    }))

    try {
      await loader.await()
    } catch (error: unknown) {
      console.error(error)
    }
    this.assertEntriesActive(ctx)
  }

  /**
   * Fail boot only when an `immediately` shell entry failed import/apply or
   * is still waiting on a missing service. Other roster failures are logged.
   */
  private assertEntriesActive(ctx: Context): void {
    const required = new Set(this.manifest.plugins.filter(row => row.immediately).map(row => row.id))
    const requiredFailures: string[] = []
    const optionalFailures: string[] = []
    const seen = new Set<string>()
    for (const entry of ctx.loader.entries()) {
      const name = entry.options.name
      seen.add(name)
      const report = this.entryActivationFailure(ctx, entry)
      if (report === undefined) continue
      if (required.has(name)) requiredFailures.push(report)
      else optionalFailures.push(report)
    }
    for (const name of required) {
      if (!seen.has(name)) requiredFailures.push(`${name}: did not activate`)
    }
    if (optionalFailures.length > 0) {
      console.error(`web boot: ${String(optionalFailures.length)} optional entr${optionalFailures.length === 1 ? 'y' : 'ies'} did not activate\n${optionalFailures.join('\n')}`)
    }
    if (requiredFailures.length > 0) {
      throw new Error(`web boot: ${String(requiredFailures.length)} required entr${requiredFailures.length === 1 ? 'y' : 'ies'} did not activate\n${requiredFailures.join('\n')}`)
    }
  }

  /**
   * Describe one loader entry that is not ACTIVE, or `undefined` when it is.
   * @param ctx - the boot context, used to name missing injects.
   * @param entry - a created loader row.
   * @returns a one-line activation report.
   */
  private entryActivationFailure(ctx: Context, entry: Entry): string | undefined {
    const name = entry.options.name
    if (entry.fiber === undefined) return `${name}: import failed (see console for the import error)`
    const state = STATE_LABELS[entry.fiber.state]
    if (state === 'active') return undefined
    if (state === 'pending') {
      const missing = Object.keys(entry.fiber.inject).filter(service => ctx.get(service) === undefined)
      return `${name}: pending (waiting for service${missing.length === 1 ? '' : 's'}: ${missing.join(', ') || 'unknown'})`
    }
    return `${name}: ${state}`
  }
}
