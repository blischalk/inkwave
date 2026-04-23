# Search Test Document

## Introduction

This document contains repeated words for testing search functionality.
The word **needle** appears multiple times throughout this document.

## Section One

Here is the first needle in the haystack. This paragraph has some
regular text around it to make sure search highlights work correctly.

## Section Two

Another needle here. And one more needle on the same line.

## Code Block

```python
# This needle should also be found inside a code block
def find_needle(haystack):
    return "needle" in haystack
```

## Special Characters

Search for em-dash — and smart quotes "hello" and 'world'.
Also test CJK: 日本語テスト and emoji: 🎉🔍

## Nested Formatting

The **bold needle** and *italic needle* and `code needle` should all match.

## Empty Section

## Final Section

One last needle at the end of the document.
