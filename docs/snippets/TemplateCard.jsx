import { HyperframesPreview } from "./HyperframesPreview.jsx";

export function TemplateCard({ id, title, description, href, portrait }) {
  const poster = `https://static.heygen.ai/hyperframes-oss/docs/images/templates/${id}.png`;
  const src = `/registry/examples/${id}/index.html`;

  return (
    <a
      href={href}
      className="not-prose group block rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden transition-shadow hover:shadow-lg no-underline"
    >
      <HyperframesPreview
        src={src}
        poster={poster}
        aspectRatio={portrait ? "9 / 16" : "16 / 9"}
        className="rounded-none"
        playerClassName="object-cover"
      />
      <div className="p-4">
        <h3 className="text-base font-semibold text-gray-900 dark:text-white m-0">
          {title}
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 mb-0">
          {description}
        </p>
      </div>
    </a>
  );
}

export function TemplateGrid({ children, columns = 2 }) {
  return (
    <div
      className="not-prose grid gap-4"
      style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
    >
      {children}
    </div>
  );
}
