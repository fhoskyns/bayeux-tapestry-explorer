import type { ComponentProps } from 'react';

export default function Image({ alt, ...props }: ComponentProps<'img'>) {
  return <span aria-label={alt || undefined} data-testid="next-image" {...props} />;
}
