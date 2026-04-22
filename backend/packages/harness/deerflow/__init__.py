"""DeerFlow Harness - LangGraph-based AI agent framework."""

import structlog


def _inject_callsite_processor() -> None:
    """Inject CallsiteParameterAdder into structlog's shared_processors
    so that log lines include filename and line number.

    This patches the langgraph_api.logging module at import time.
    Must be called before any agent code emits log messages.
    """
    try:
        import langgraph_api.logging as lg_logging
    except ImportError:
        return

    callsite_adder = structlog.processors.CallsiteParameterAdder(
        parameters=[
            structlog.processors.CallsiteParameter.FILENAME,
            structlog.processors.CallsiteParameter.LINENO,
            structlog.processors.CallsiteParameter.FUNC_NAME,
        ]
    )

    if callsite_adder not in lg_logging.shared_processors:
        lg_logging.shared_processors.insert(0, callsite_adder)

    structlog.configure(
        processors=[
            structlog.stdlib.filter_by_level,
            *lg_logging.shared_processors,
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )


_inject_callsite_processor()
