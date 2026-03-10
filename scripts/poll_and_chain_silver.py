"""Poll Bronze notebook job and auto-trigger Silver when done."""
import json, time, sys, urllib.request, urllib.parse, os

API_BASE = 'http://127.0.0.1:8787'

BRONZE_JOB_ID = '53f1e075-3f1d-4e47-8114-48544c123557'
BRONZE_NB_ID = '7a6fcd8f-088f-488c-941d-e4029d017e20'
SILVER_NB_ID = '7a6fcd8f-088f-488c-941d-e4029d017e20'  # Same processing notebook

POLL_INTERVAL = 30  # seconds

def log(msg):
    from datetime import datetime
    ts = datetime.now().strftime('%H:%M:%S')
    print(f'[{ts}] {msg}', flush=True)


def poll_job(job_id, nb_id):
    """Poll a notebook job until completion."""
    url = f'{API_BASE}/api/notebook-debug/job-status?jobId={job_id}&notebookId={nb_id}'
    while True:
        try:
            req = urllib.request.Request(url)
            resp = urllib.request.urlopen(req)
            data = json.loads(resp.read())
            status = data.get('status', 'Unknown')

            if status in ('Completed', 'Failed', 'Cancelled'):
                return status, data

            log(f'  Status: {status}')
        except Exception as e:
            log(f'  Poll error: {e}')

        time.sleep(POLL_INTERVAL)


def trigger_silver():
    """Trigger Silver notebook run."""
    log('Triggering Silver notebook...')
    payload = json.dumps({
        'notebookId': SILVER_NB_ID,
        'layer': 'silver',
        'maxEntities': 0,
    }).encode()
    req = urllib.request.Request(
        f'{API_BASE}/api/notebook-debug/run',
        data=payload, method='POST',
        headers={'Content-Type': 'application/json'}
    )
    resp = urllib.request.urlopen(req)
    result = json.loads(resp.read())
    return result


def main():
    log('=' * 60)
    log('Bronze -> Silver Auto-Chain')
    log(f'Polling Bronze job: {BRONZE_JOB_ID}')
    log('=' * 60)

    # Poll Bronze
    status, data = poll_job(BRONZE_JOB_ID, BRONZE_NB_ID)
    log(f'Bronze finished: {status}')

    if status == 'Cancelled':
        log('Bronze was cancelled. Not triggering Silver.')
        return 1

    # Trigger Silver regardless of Bronze success/failure
    # (some entities may have succeeded even if others failed)
    try:
        result = trigger_silver()
        if result.get('success'):
            silver_job = result.get('jobInstanceId', '')
            count = result.get('entityCount', 0)
            log(f'Silver triggered! {count} entities, job: {silver_job}')

            # Poll Silver
            log('Polling Silver...')
            s_status, s_data = poll_job(silver_job, SILVER_NB_ID)
            log(f'Silver finished: {s_status}')
        else:
            log(f'Silver trigger failed: {result.get("error", "unknown")}')
            return 1
    except Exception as e:
        log(f'Silver trigger error: {e}')
        return 1

    log('')
    log('=' * 60)
    log('COMPLETE: Bronze + Silver chain finished')
    log('=' * 60)
    return 0


if __name__ == '__main__':
    sys.exit(main())
