/**
 * A provider-neutral model reference, as an explicit `{ provider, model }` object rather
 * than a colon-delimited string like `"openai:gpt-..."` - chosen because the registry
 * already looks providers up by id, so an object avoids parsing/splitting a string just to
 * get the same information back. See docs/adr/0006-model-provider-abstraction.md.
 */
export interface ModelReference {
  readonly provider: string;
  readonly model: string;
}
