import { createContext, useContext, type ComponentProps, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import './button.css';

export type ButtonVariant = 'primary' | 'secondary' | 'soft' | 'ghost' | 'link' | 'menu' | 'field';
export type ButtonTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';
export type ButtonSize = 'mini' | 'compact' | 'small' | 'medium' | 'large';
export type ButtonProps = Omit<ComponentProps<'button'>, 'style' | 'color'> & {
  variant?: ButtonVariant;
  tone?: ButtonTone;
  size?: ButtonSize;
  iconOnly?: boolean;
  width?: 'auto' | 'action' | 'wide' | 'filter' | 'block';
  busy?: boolean;
};

const MenuButtonsContext = createContext(false);
const ButtonSizeContext = createContext<ButtonSize>('medium');
export function CompactButtons({children,enabled=true}:{children:ReactNode;enabled?:boolean}) {
  return <ButtonSizeContext.Provider value={enabled?'compact':'medium'}>{children}</ButtonSizeContext.Provider>;
}
export function MenuButtons({children, enabled = true}: {children: ReactNode; enabled?: boolean}) {
  return <MenuButtonsContext.Provider value={enabled}>{children}</MenuButtonsContext.Provider>;
}

/** Action controls use presets; className is for placement and existing DOM hooks. */
export function Button({ variant = 'secondary', tone = variant === 'primary' || variant === 'soft' || variant === 'link' ? 'primary' : 'neutral', size: requestedSize, iconOnly = false, width = 'auto', busy = false, disabled, type = 'button', className = '', children, ...props }: ButtonProps) {
  const menu = useContext(MenuButtonsContext);
  const defaultSize=useContext(ButtonSizeContext),size=requestedSize||defaultSize;
  return <button {...props} type={type} className={`ui-button ${className}`.trim()} data-variant={menu ? 'menu' : variant} data-tone={menu && tone === 'primary' ? 'neutral' : tone} data-size={size} data-icon-only={!menu && iconOnly || undefined} data-width={menu ? 'block' : width} data-busy={busy || undefined} aria-busy={busy || props['aria-busy']} disabled={disabled || busy}>{children}</button>;
}

type ButtonLinkProps = Omit<ComponentProps<typeof Link>, 'style' | 'color'> & Pick<ButtonProps, 'variant' | 'tone' | 'size' | 'iconOnly' | 'width'>;
export function ButtonLink({variant = 'secondary', tone = variant === 'primary' || variant === 'soft' || variant === 'link' ? 'primary' : 'neutral', size = 'medium', iconOnly, width = 'auto', className = '', ...props}: ButtonLinkProps) {
  return <Link {...props} className={`ui-button ${className}`.trim()} data-variant={variant} data-tone={tone} data-size={size} data-icon-only={iconOnly || undefined} data-width={width}/>;
}
