# List Items with Code Blocks

## Ordered list with fenced code

1. Run the following command:
   ```
   echo "hello world"
   ```
2. Check the output
3. Verify it matches expected

## Unordered list with fenced code

- First install dependencies:
  ```bash
  pip install requests
  ```
- Then run the script
- Check logs for errors

## Nested content in list items

1. Configure the database:
   ```sql
   CREATE TABLE users (id INT, name VARCHAR(255));
   ```
2. Insert test data:
   ```sql
   INSERT INTO users VALUES (1, 'Alice');
   ```
3. Verify the results

## Checkbox list

- [x] Write the code
- [ ] Add tests
- [ ] Deploy to production

## Mixed special characters in code blocks

1. Handle single quotes properly:
   ```
   SELECT * FROM users WHERE name = 'O''Brien';
   ```
2. Handle angle brackets:
   ```html
   <div class="container"><p>Hello</p></div>
   ```
3. Handle backticks inside code:
   ```
   Use `marked.parse()` to render markdown
   ```

## Multi-line continuation without code

- This is a list item
  that continues on the next line
  and even a third line
- Second item here

## Simple paragraph after list

- item one
- item two

This is a paragraph after the list.
