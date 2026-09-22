# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the right-hand column to match whatever vocabulary you actually use.

## How a label is applied here

This repo's tracker is **files, not GitHub Issues**, so there is nothing to `--add-label`.
A label is the value of the `Status:` line near the top of the issue file:

```markdown
Status: ready-for-agent
```

Applying a label means rewriting that line; removing one means replacing it with the
role that now holds. One `Status:` line per file — these five roles are mutually
exclusive states, not tags to accumulate.
