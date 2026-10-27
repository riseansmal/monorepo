fn greet(name: &str) -> String {
    format!("hello, {name}")
}

fn main() {
    println!("{}", greet("monorepo"));
}

#[cfg(test)]
mod tests {
    use super::greet;
    #[test]
    fn greets_by_name() {
        assert_eq!(greet("world"), "hello, world");
    }
}
