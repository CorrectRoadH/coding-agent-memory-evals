"""Function decorator helpers."""
import functools

def _condition_info(func, cache, key, lock, cond, info):
    raise NotImplementedError()

def _locked_info(func, cache, key, lock, info):
    raise NotImplementedError()

def _unlocked_info(func, cache, key, info):
    raise NotImplementedError()

def _uncached_info(func, info):
    raise NotImplementedError()

def _condition(func, cache, key, lock, cond):
    raise NotImplementedError()

def _locked(func, cache, key, lock):
    raise NotImplementedError()

def _unlocked(func, cache, key):
    raise NotImplementedError()

def _uncached(func):
    raise NotImplementedError()

def _wrapper(func, cache, key, lock=None, cond=None, info=None):
    raise NotImplementedError()
