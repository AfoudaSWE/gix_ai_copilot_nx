# Diagnostics

Diagnostics is a persistent panel, not a wizard step. It refreshes after every Studio action and
every 15 seconds. `GET /__gix/api/diagnostics` returns four groups and the current `stage`:
`pre-discovery`, `discovered`, `generated`, `approved`, `applied` or `validation-failed`.

| Group | Rows |
| --- | --- |
| Runtime | Runtime, Server, Provider, Streaming, Action Firewall, DevTools, Registered Tools |
| Discovery | Project Discovery (Not run / Complete), APIs, Components, Permissions, Context Candidates, Discovery Warnings |
| Generation | Tool Candidates, Context Candidates, UI Candidates, Pending Proposals, Security Warnings, Conflicts |
| Apply | Generated Tools, Context Sources, Generative UI, and each validation check from the latest apply |

Every number comes from the discovery result or a proposal. None is estimated.

Runtime facts the Studio cannot observe itself (runtime attached, firewall configured, DevTools
enabled, registered tool count) come from the host's `facts` option. The Provider and Streaming
rows stay `unknown` ("Configured, not tested") until you run **Test Connection**.
