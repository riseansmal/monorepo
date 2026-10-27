from hello_python import greet


def test_greet() -> None:
    assert greet("monorepo") == "hello, monorepo"
