/**
 * Build-identity row registered into the General section item slot: the
 * released version the running client artifacts were built from, so a reader
 * can name their build without opening a package manifest. Ownerless copy, so
 * the settings shell owns it. An unbuilt source run embeds no version and says
 * so instead of naming a number it does not have.
 */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import css from './VersionRow.module.css'

/** Full component props: runtime share plus the settings locale seat. */
export type VersionRowComponentProps = PropsRuntime<'settings.general.item'> & PropsLocale<'settings'>

/**
 * Render the version row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function VersionRow({ t }: VersionRowComponentProps) {
  // The bundler inlines this read as a literal, so a built artifact carries
  // its own version and only an unbuilt run reaches the unknown label.
  const version = process.env.DSH_CLIENT_VERSION

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('version.title')}</div>
      </div>
      <div className={css.value}>{version ?? t('version.unknown')}</div>
    </div>
  )
}
