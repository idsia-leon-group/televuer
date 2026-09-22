# unitree_televuer/__init__.py
import os

# Python 3.10 TLS sendfile can fail under backpressure while serving large XR
# assets. Use aiohttp's buffered writes before Vuer imports its HTTP server.
os.environ["AIOHTTP_NOSENDFILE"] = "1"

from .televuer import TeleVuer
from .tv_wrapper import TeleVuerWrapper, TeleData