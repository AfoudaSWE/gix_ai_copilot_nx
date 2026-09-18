#!/usr/bin/env python3
"""
Validates the .claude/skills directory structure for the AI Copilot SDK.

Standard-library only (per the dependency-policy skill: no new dependency for a
validation script). Run with:

    python .claude/skills/validate_skills.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

SKILLS_DIR = Path(__file__).resolve().parent

REQUIRED_SKILLS = [
    "ai-copilot-project",
    "project-architecture",
    "typescript-standards",
    "nx-monorepo",
    "sdk-design",
    "protocol-design",
    "node-backend",
    "react-sdk",
    "angular-sdk",
    "ai-runtime",
    "tool-system",
    "agent-architecture",
    "context-engine",
    "generative-ui",
    "security",
    "action-firewall",
    "hitl",
    "openapi-tools",
    "mcp",
    "rag",
    "memory",
    "observability",
    "testing",
    "ai-evals",
    "devtools",
    "database",
    "redis-jobs",
    "api-design",
    "performance",
    "accessibility",
    "documentation",
    "git-workflow",
    "code-review",
    "dependency-policy",
    "backward-compatibility",
    "phase-gate",
]

FRONTMATTER_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*\n", re.DOTALL)


class ValidationError(Exception):
    pass


def parse_frontmatter(text: str, skill_dir: str) -> dict:
    match = FRONTMATTER_RE.match(text)
    if not match:
        raise ValidationError(f"{skill_dir}: SKILL.md is missing YAML frontmatter (--- block)")

    raw = match.group(1)
    fields: dict[str, str] = {}
    current_key = None
    for line in raw.splitlines():
        if not line.strip():
            continue
        kv_match = re.match(r"^([A-Za-z0-9_]+):\s*(.*)$", line)
        if kv_match and not line.startswith(" "):
            current_key = kv_match.group(1)
            fields[current_key] = kv_match.group(2).strip()
        elif current_key is not None:
            # continuation line (e.g. multi-line description) - append
            fields[current_key] += " " + line.strip()

    if "name" not in fields or not fields["name"]:
        raise ValidationError(f"{skill_dir}: frontmatter missing required 'name' field")
    if "description" not in fields or not fields["description"]:
        raise ValidationError(f"{skill_dir}: frontmatter missing required 'description' field")

    return fields


def find_broken_skill_links(text: str, valid_names: set[str], skill_dir: str) -> list[str]:
    problems = []
    for link in re.findall(r"\[\[([a-z0-9-]+)\]\]", text):
        if link not in valid_names:
            problems.append(f"{skill_dir}: references unknown skill link [[{link}]]")
    return problems


def main() -> int:
    errors: list[str] = []
    warnings: list[str] = []
    seen_names: dict[str, str] = {}
    all_texts: dict[str, str] = {}

    # 1. Every required directory exists, contains SKILL.md, frontmatter is valid.
    for skill in REQUIRED_SKILLS:
        skill_dir = SKILLS_DIR / skill
        skill_file = skill_dir / "SKILL.md"

        if not skill_dir.is_dir():
            errors.append(f"MISSING DIRECTORY: {skill}")
            continue
        if not skill_file.is_file():
            errors.append(f"MISSING FILE: {skill}/SKILL.md")
            continue

        text = skill_file.read_text(encoding="utf-8")
        all_texts[skill] = text

        try:
            fields = parse_frontmatter(text, skill)
        except ValidationError as exc:
            errors.append(str(exc))
            continue

        name = fields["name"]
        if name != skill:
            errors.append(
                f"{skill}: frontmatter name '{name}' does not match directory name '{skill}'"
            )

        # 4. No duplicate skill names.
        if name in seen_names:
            errors.append(
                f"DUPLICATE NAME: '{name}' used by both {seen_names[name]} and {skill}"
            )
        else:
            seen_names[name] = skill

    # 2. README exists.
    readme = SKILLS_DIR / "README.md"
    if not readme.is_file():
        errors.append("MISSING FILE: README.md")

    valid_names = set(REQUIRED_SKILLS)

    # 5/6. Master skill references valid skills; phase mapping references valid skills.
    master_text = all_texts.get("ai-copilot-project", "")
    if master_text:
        errors.extend(find_broken_skill_links(master_text, valid_names, "ai-copilot-project"))
        for phase_num in range(1, 13):
            pattern = rf"Phase {phase_num:02d}|\*\*Phase {phase_num}\*\*"
            if not re.search(pattern, master_text):
                warnings.append(
                    f"ai-copilot-project: could not confirm explicit mapping text for Phase {phase_num}"
                )
    else:
        errors.append("ai-copilot-project/SKILL.md missing or unreadable; cannot validate routing/phase mapping")

    # Cross-check all skill-to-skill links across every file.
    for skill, text in all_texts.items():
        errors.extend(find_broken_skill_links(text, valid_names, skill))

    # 8/9/10/11/12/14/15 - targeted content checks for specific mandatory guarantees.
    content_checks = [
        ("phase-gate", r"never automatically (begin|continue)", "phase-gate must explicitly forbid automatic phase progression"),
        ("security", r"[Zz]ero trust", "security skill must state a zero-trust posture for model output"),
        ("security", r"[Nn]ever rely on.*system prompt", "security skill must state system prompts are not a security boundary"),
        ("tool-system", r"[Zz]od", "tool-system must require schema validation (Zod)"),
        ("mcp", r"must not bypass the normal security pipeline", "mcp skill must require MCP tools go through the firewall"),
        ("openapi-tools", r"[Nn]ever automatically expose all", "openapi-tools must forbid auto-exposing all endpoints"),
        ("rag", r"[Aa]uthorization is applied before", "rag skill must require authorization before context exposure"),
        ("testing", r"must not claim", "testing skill must forbid false success claims"),
        ("code-review", r"must not claim", "code-review skill must forbid false success claims"),
    ]
    for skill, pattern, message in content_checks:
        text = all_texts.get(skill, "")
        if not text or not re.search(pattern, text):
            errors.append(f"CONTENT CHECK FAILED ({skill}): {message}")

    # Report
    print(f"Skills checked: {len(REQUIRED_SKILLS)} required, {len(all_texts)} found\n")

    if warnings:
        print("WARNINGS:")
        for w in warnings:
            print(f"  - {w}")
        print()

    if errors:
        print("ERRORS:")
        for e in errors:
            print(f"  - {e}")
        print(f"\nVALIDATION FAILED ({len(errors)} error(s))")
        return 1

    print("VALIDATION PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
