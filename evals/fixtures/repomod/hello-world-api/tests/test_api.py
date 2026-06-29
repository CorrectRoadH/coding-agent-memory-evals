"""
Integration tests for the hello-world API.

Tests verify that the API correctly handles personalized Hello messages
with various input scenarios.
"""

import requests
import pytest


class TestHelloAPI:
    """Test suite for the Hello API endpoint."""

    def test_default_case_no_name_parameter(self, api_base_url):
        """Test 1: Default case - no name parameter should return 'Hello World!'"""
        response = requests.get(f"{api_base_url}/")

        assert response.status_code == 200
        assert "application/json" in response.headers["Content-Type"]

        data = response.json()
        assert data["message"] == "Hello World!"

    def test_custom_name_parameter(self, api_base_url):
        """Test 2: Custom name parameter."""
        response = requests.get(f"{api_base_url}/", params={"name": "Alice"})

        assert response.status_code == 200
        assert "application/json" in response.headers["Content-Type"]

        data = response.json()
        assert data["message"] == "Hello Alice!"

    def test_name_with_spaces(self, api_base_url):
        """Test 3: Name with spaces (URL encoded)."""
        response = requests.get(f"{api_base_url}/", params={"name": "John Doe"})

        assert response.status_code == 200
        assert "application/json" in response.headers["Content-Type"]

        data = response.json()
        assert data["message"] == "Hello John Doe!"

    def test_empty_name_parameter(self, api_base_url):
        """Test 4: Empty name parameter - should default to World or handle empty string."""
        response = requests.get(f"{api_base_url}/", params={"name": ""})

        assert response.status_code == 200
        assert "application/json" in response.headers["Content-Type"]

        data = response.json()
        assert "message" in data

    def test_special_characters_in_name(self, api_base_url):
        """Test 5: Special characters in name."""
        response = requests.get(f"{api_base_url}/", params={"name": "Test123"})

        assert response.status_code == 200
        assert "application/json" in response.headers["Content-Type"]

        data = response.json()
        assert data["message"] == "Hello Test123!"

    def test_name_with_leading_trailing_spaces(self, api_base_url):
        """Test 6: Name with leading/trailing spaces should be trimmed."""
        response = requests.get(f"{api_base_url}/", params={"name": " Space "})

        assert response.status_code == 200
        assert "application/json" in response.headers["Content-Type"]

        data = response.json()
        assert data["message"] == "Hello Space!"
