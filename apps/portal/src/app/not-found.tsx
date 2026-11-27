import Link from 'next/link';

export default function NotFound() {
  return (
    <main id="main" tabIndex={-1} className="px-main">
      <h1 className="px-h1">Page not found</h1>
      <p>
        <Link href="/">Go to the portal home</Link>
      </p>
    </main>
  );
}
