# tables/

Schema definitions, provisioning scripts, and seed data for the custom tables
on the `cto-office` tenant.

Custom tables are managed via the platform API at `/api/v1/custom-tables`, not
checked-in DDL. Files in this directory exist to document the schema and to
script provisioning/seeding.

## Existing tables (cto-office prod)

| Table        | Used by                                                          |
|--------------|------------------------------------------------------------------|
| `pods`       | apps/pod-staffing, agents/pod-staffing-ops                       |
| `people`     | apps/pod-staffing, agents/pod-staffing-ops                       |
| `assignments`| apps/pod-staffing, agents/pod-staffing-ops                       |
| `go_lives`   | apps/pod-staffing, agents/pod-staffing-ops                       |
| `pod_agents` | apps/pod-staffing, agents/pod-staffing-ops (seeded 2026-05-20)   |
| weekly grid  | apps/pod-staffing, agents/pod-staffing-ops                       |

Provisioning/seed scripts currently live in
`apps/pod-staffing/scripts/` — move here when extracted from the app bundle.
