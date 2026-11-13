// GitHub-flavoured markdown for PR bodies + comments.
// UNTRUSTED: anyone can comment on a public repo, and this window holds window.corral (git, push, delete…).
// so: marked → DOMPurify (no scripts, no on* handlers, no javascript: urls, no iframes/forms) → html.
import DOMPurify from "dompurify";
import { marked } from "marked";
import { useMemo } from "react";

marked.setOptions({ gfm: true, breaks: true });

export function Markdown({ text }: { text: string }) {
	const html = useMemo(
		() =>
			DOMPurify.sanitize(marked.parse(text ?? "", { async: false }) as string, {
				FORBID_TAGS: ["style", "form", "input", "button", "textarea", "select", "iframe", "object", "embed"],
				FORBID_ATTR: ["style"],
			}),
		[text],
	);
	// a plain <a> click would navigate the whole app window to that site: send https links to the real browser
	const onClick = (e: React.MouseEvent) => {
		const a = (e.target as HTMLElement).closest("a");
		if (!a) return;
		e.preventDefault();
		if (a.href.startsWith("https://")) window.corral.openUrl(a.href);
	};
	return <div className="md" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
