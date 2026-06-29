"""
Pytest configuration and fixtures for hello-world-api testing.
"""

import pytest


def pytest_addoption(parser):
    """Add custom command line options."""
    parser.addoption(
        "--api-port",
        action="store",
        default="3000",
        help="Port where the API is running (default: 3000)",
    )


@pytest.fixture
def api_port(request) -> str:
    """Get the API port from command line options."""
    return request.config.getoption("--api-port")


@pytest.fixture
def api_base_url(api_port: str) -> str:
    """Get the base URL for the API."""
    return f"http://localhost:{api_port}"
