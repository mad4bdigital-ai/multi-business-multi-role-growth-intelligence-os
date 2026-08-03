# Draft guard TOCTOU publisher trigger

Bounded same-repository trigger for the temporary never-merge publisher on `main@dd929093dd83d2c91ac817ff60d324eca2b71e51`.

The publisher may create only `gpt/incident-5021/draft-merge-guard-toctou-dd929093-20260804` as one commit and must not modify `main`, `Production`, providers, deployments, credentials, SQL, migrations, databases, or external systems.
