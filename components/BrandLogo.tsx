import React, { useEffect, useState } from 'react';

interface BrandLogoProps {
  src?: string | null;
  alt: string;
  className?: string;
  imgClassName?: string;
  fallback: React.ReactNode;
}

/**
 * Safely renders an uploaded/remote brand logo with automatic white backdrop
 * (so dark/transparent PNG/WebP logos remain crisp in dark mode) and automatic
 * fallback if the image fails to load.
 */
export const BrandLogo: React.FC<BrandLogoProps> = ({
  src,
  alt,
  className = 'w-9 h-9 rounded-xl',
  imgClassName = 'w-full h-full object-contain rounded-lg',
  fallback,
}) => {
  const cleanSrc = typeof src === 'string' ? src.trim() : '';
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [cleanSrc]);

  if (!cleanSrc || hasError) {
    return <>{fallback}</>;
  }

  return (
    <div
      className={`${className} bg-white border border-slate-200/80 flex items-center justify-center p-1 overflow-hidden shadow-sm shrink-0`}
    >
      <img
        src={cleanSrc}
        alt={alt}
        className={imgClassName}
        onError={() => setHasError(true)}
      />
    </div>
  );
};
