# Content structure

## Website routes

| Route | Page |
| --- | --- |
| `/` | Hero and demo, integrations, capabilities, architecture explorer, context and tools, generative UI, OpenAPI and MCP, RAG and memory, agents and workflows, security and approvals, DevTools and observability, frameworks, production, quickstart, CTA |
| `/enterprise` | Action Firewall, human-in-the-loop, audit and PII, controls |
| `/examples` | Filterable list of the real `examples/` applications |

The dropdown menus (`src/site/menu.ts`) link only to real pages.

## Documentation

`DOC_SECTIONS` in `apps/docs/src/docs/nav.ts` defines the sidebar, the reading order
(previous/next), search grouping, the sitemap and the prerender list. Sections: Getting Started,
Frameworks, Application Awareness, Tools & Integrations, Generative UI, Models, Security,
Knowledge & Memory, Agents & Workflows, Observability, Testing & Evaluations, Production, CLI and
Reference.

URLs are readable and stable: `/docs/<slug>` and `/docs/production/<slug>`. The generated API
reference lives at `/docs/api` and `/docs/api/<package>`, with one anchor per export (for
example `/docs/api/react#useCopilotContext`).

Status badges (Beta / Experimental) mirror the README "Capability maturity" table.
