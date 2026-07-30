import { Link } from 'react-router-dom';

export const AUTH_BRAND_LOGO_LIGHT = '/brand/bizziemoney-auth-light.png';
export const AUTH_BRAND_LOGO_DARK = '/brand/bizziemoney-auth-dark.png';
export const APP_BRAND_LOGO_LIGHT = '/brand/bizziemoney-app-light.png';
export const APP_BRAND_LOGO_DARK = '/brand/bizziemoney-app-dark.png';
export const AUTH_BRAND_DISPLAY_LIGHT =
  '/brand/bizziemoney-auth-light-display.png';
export const AUTH_BRAND_DISPLAY_DARK =
  '/brand/bizziemoney-auth-dark-display.png';
export const APP_BRAND_DISPLAY_LIGHT =
  '/brand/bizziemoney-app-light-display.png';
export const APP_BRAND_DISPLAY_DARK = '/brand/bizziemoney-app-dark-display.png';

function ThemeBrandImages({
  className,
  darkSource,
  height,
  lightSource,
  width,
}: {
  className: string;
  darkSource: string;
  height: number;
  lightSource: string;
  width: number;
}) {
  return (
    <>
      <img
        alt=""
        aria-hidden="true"
        className={`${className} theme-brand-image theme-brand-image--light`}
        draggable="false"
        height={height}
        src={lightSource}
        width={width}
      />
      <img
        alt=""
        aria-hidden="true"
        className={`${className} theme-brand-image theme-brand-image--dark`}
        draggable="false"
        height={height}
        src={darkSource}
        width={width}
      />
    </>
  );
}

export function Brand() {
  return (
    <Link aria-label="BizzieMoney overview" className="brand" to="/">
      <ThemeBrandImages
        className="brand__image"
        darkSource={APP_BRAND_DISPLAY_DARK}
        height={79}
        lightSource={APP_BRAND_DISPLAY_LIGHT}
        width={528}
      />
      <span className="sr-only">BizzieMoney</span>
    </Link>
  );
}

export function AuthBrand() {
  return (
    <Link aria-label="BizzieMoney home" className="auth-brand" to="/">
      <span aria-label="BizzieMoney" className="auth-brand__visual" role="img">
        <ThemeBrandImages
          className="auth-brand__image"
          darkSource={AUTH_BRAND_DISPLAY_DARK}
          height={462}
          lightSource={AUTH_BRAND_DISPLAY_LIGHT}
          width={930}
        />
      </span>
    </Link>
  );
}
