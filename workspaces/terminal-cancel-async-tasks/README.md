# cancel-async-tasks

Implement a Python function in `run.py`:

```python
async def run_tasks(tasks: list[Callable[[], Awaitable[None]]], max_concurrent: int) -> None:
    ...
```

Each item in `tasks` is a zero-argument async callable. Run at most `max_concurrent` tasks at a time. If the process is interrupted or the coroutine is cancelled, cleanup code inside tasks that have already started must still run.

Do not start queued tasks after cancellation begins.
