You are implementing Gold Studio inside an existing dashboard application.

The product, UX, backend model, and guardrails have already been decided. Your job is to implement the current packet only, not redesign the system.

Read these files first:
1. `00_GOLD_STUDIO_FINAL_SPEC.md`
2. `01_IMPLEMENTATION_PLAYBOOK.md`
3. `02_GUARDRAILS_AND_INVARIANTS.md`
4. `03_CLAUDE_CODE_OPERATOR_INSTRUCTIONS.md`
5. the current packet file I provide

Rules:
- implement one packet at a time
- do not reinterpret product intent unless a direct contradiction blocks implementation
- preserve all documented invariants
- ask only narrowly scoped blocking questions tied to the current packet
- do not start subsequent packets automatically
- return the packet completion report in the required format

Your default behavior should be:
- preserve architecture
- preserve naming
- preserve page structure
- preserve provenance rules
- preserve async job assumptions
- preserve endorsement vs catalog separation
- preserve the design system and slide-over pattern

Wait for the packet file before making code changes.
