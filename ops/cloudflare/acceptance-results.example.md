# Cloudflare acceptance record

Copy this file to `acceptance-results.md`. Record only non-secret observations.
Do not include email addresses, cookies, Access assertions, credentials, account
IDs, private object bodies, or copied response bodies.

## Target confirmation

| Field | Recorded value |
| --- | --- |
| Date (UTC) | NOT RUN |
| Operator | NOT RUN |
| Cloudflare account display name | NOT RUN |
| Zone | NOT RUN |
| Application hostname | NOT RUN |
| Pages hostname | NOT RUN |
| R2 bucket | NOT RUN |
| Worker name | NOT RUN |
| Pre-deploy Worker version | NOT RUN |
| Deployed Worker version | NOT RUN |

## Result vocabulary

- `PASS`: performed and the observed result matched the criterion.
- `FAIL`: performed and the observed result did not match the criterion.
- `NOT RUN`: not performed or evidence was unavailable. Never infer `PASS`.

## Configuration and access boundary

| Check | Result | Non-secret evidence |
| --- | --- | --- |
| Local repository checks pass | NOT RUN | |
| Acceptance configuration validator passes | NOT RUN | |
| Wrangler deploy dry-run passes | NOT RUN | |
| Only the application and pages custom domains route to the Worker | NOT RUN | |
| `workers.dev` is disabled | NOT RUN | |
| Preview URLs are disabled | NOT RUN | |
| Both hostnames are covered by Access applications | NOT RUN | |
| No more-specific Access application overlaps either hostname | NOT RUN | |
| Neither hostname application allows Everyone, Bypass, or Service Auth | NOT RUN | |
| R2 public development URL is disabled | NOT RUN | |
| R2 has no public custom domain | NOT RUN | |
| Daily `0 3 * * *` UTC Cron Trigger is present | NOT RUN | |

## Browser journey

| Check | Result | Non-secret evidence |
| --- | --- | --- |
| The authenticated creator can open the control hostname | NOT RUN | |
| The creator can publish the approved fixture directory | NOT RUN | |
| The returned URL uses the approved pages hostname | NOT RUN | |
| A different authenticated viewer can open the published page | NOT RUN | |
| An unauthenticated application-root request is stopped by Access | NOT RUN | |
| An unauthenticated `POST /publish` is stopped by Access | NOT RUN | |
| An unauthenticated request to the returned `/p/<site>/` URL is stopped by Access | NOT RUN | |
| An uploading site is not served before activation | NOT RUN | |
| The active site is served before its expiry | NOT RUN | |
| The site returns 404 after its expiry | NOT RUN | |
| A later scheduled cleanup removes its metadata and content objects | NOT RUN | |

## Rollback and residual gaps

| Check | Result | Non-secret evidence |
| --- | --- | --- |
| Previous Worker version is known before deploy | NOT RUN | |
| Worker rollback command and target were reviewed | NOT RUN | |
| Access rollback steps were reviewed | NOT RUN | |
| DNS/custom-domain rollback steps were reviewed | NOT RUN | |
| Worker rollback itself does not delete the R2 bucket or objects | NOT RUN | |
| Continued Cron cleanup during rollback was reviewed | NOT RUN | |

Unverified facts and residual risks:

- NOT RUN
